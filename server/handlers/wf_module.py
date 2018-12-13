import datetime
import functools
from typing import Any, Dict
from channels.db import database_sync_to_async
from dateutil.parser import isoparse
from server import rabbitmq, websockets
from server.models import Workflow, WfModule
from server.models.commands import ChangeParametersCommand, \
        DeleteModuleCommand, ChangeDataVersionCommand, \
        ChangeWfModuleNotesCommand
from .types import HandlerError
from .decorators import register_websockets_handler, websockets_handler


@database_sync_to_async
def _load_wf_module(workflow: Workflow, wf_module_id: int) -> WfModule:
    """Returns a WfModule or raises HandlerError."""
    try:
        return WfModule.live_in_workflow(workflow).get(id=wf_module_id)
    except WfModule.DoesNotExist:
        raise HandlerError('DoesNotExist: WfModule not found')


def _loading_wf_module(func):
    @functools.wraps(func)
    async def inner(workflow: Workflow, wfModuleId: int, **kwargs):
        wf_module = await _load_wf_module(workflow, wfModuleId)
        return await func(workflow=workflow, wf_module=wf_module, **kwargs)
    return inner


@register_websockets_handler
@websockets_handler('write')
@_loading_wf_module
async def set_params(workflow: Workflow, wf_module: WfModule,
                     values: Dict[str, Any], **kwargs):
    if not isinstance(values, dict):
        raise HandlerError('BadRequest: values must be an Object')

    await ChangeParametersCommand.create(workflow=workflow,
                                         wf_module=wf_module,
                                         new_values=values)


@register_websockets_handler
@websockets_handler('write')
@_loading_wf_module
async def delete(workflow: Workflow, wf_module: WfModule, **kwargs):
    await DeleteModuleCommand.create(workflow=workflow, wf_module=wf_module)


@database_sync_to_async
def _find_precise_version(wf_module: WfModule,
                          version: datetime.datetime) -> datetime.datetime:
    # TODO maybe let's not use microsecond-precision numbers as
    # StoredObject IDs and then send the client
    # millisecond-precision identifiers. We _could_ just pass
    # clients the IDs, for instance.
    #
    # Select a version within 1ms of the (rounded _or_ truncated)
    # version we sent the client.
    #
    # (Let's not change the way we JSON-format dates just to avoid
    # this hack. That would be even worse.)
    try:
        return wf_module.stored_objects.filter(
            stored_at__gte=version - datetime.timedelta(microseconds=500),
            stored_at__lt=version + datetime.timedelta(milliseconds=1)
        ).values_list('stored_at', flat=True)[0]
    except:
        return version


@database_sync_to_async
def _mark_stored_object_read(wf_module: WfModule,
                             version: datetime.datetime) -> None:
    wf_module.stored_objects.filter(stored_at=version).update(read=True)


@register_websockets_handler
@websockets_handler('write')
@_loading_wf_module
async def set_stored_data_version(workflow: Workflow, wf_module: WfModule,
                                  version: str, **kwargs):
    try:
        # cast to str: dateutil.parser may have vulnerability with non-str
        version = str(version)
        version = isoparse(version)
    except (ValueError, OverflowError, TypeError):
        raise HandlerError('BadRequest: version must be an ISO8601 datetime')

    version = await _find_precise_version(wf_module, version)

    await ChangeDataVersionCommand.create(workflow=workflow,
                                          wf_module=wf_module,
                                          new_version=version)

    await _mark_stored_object_read(wf_module, version)


@register_websockets_handler
@websockets_handler('write')
@_loading_wf_module
async def set_notes(workflow: Workflow, wf_module: WfModule, notes: str,
                    **kwargs):
    notes = str(notes)  # cannot error from JSON input
    await ChangeWfModuleNotesCommand.create(workflow=workflow,
                                            wf_module=wf_module,
                                            new_value=notes)


@database_sync_to_async
def _set_collapsed_in_db(wf_module: WfModule, is_collapsed: bool) -> None:
    wf_module.is_collapsed = is_collapsed
    wf_module.save(update_fields=['is_collapsed'])


@register_websockets_handler
@websockets_handler('write')
@_loading_wf_module
async def set_collapsed(workflow: Workflow, wf_module: WfModule,
                        isCollapsed: bool, **kwargs):
    is_collapsed = bool(isCollapsed)  # cannot error from JSON input
    # TODO make this a Command
    await _set_collapsed_in_db(wf_module, is_collapsed)


@database_sync_to_async
def _set_wf_module_busy(wf_module):
    wf_module.is_busy = True
    wf_module.save(update_fields=['is_busy'])


@register_websockets_handler
@websockets_handler('write')
@_loading_wf_module
async def fetch(workflow: Workflow, wf_module: WfModule, **kwargs):
    await _set_wf_module_busy(wf_module)
    await rabbitmq.queue_fetch(wf_module)
    await websockets.ws_client_send_delta_async(workflow.id, {
        'updateWfModules': {
            str(wf_module.id): {'is_busy': True, 'fetch_error': ''},
        }
    })