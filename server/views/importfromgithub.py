from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from rest_framework import status
from rest_framework.decorators import api_view
from server.importmodulefromgithub import import_module_from_github
from server.serializers import ModuleSerializer


@api_view(['POST'])
@login_required
def import_from_github(request):
    if not request.user.is_staff:
        return JsonResponse({'error': 'Only an admin can call this method'},
                            status=status.HTTP_403_FORBIDDEN)

    try:
        module = import_module_from_github(request.data["url"])
        data = ModuleSerializer(module).data
        return JsonResponse(data, status=status.HTTP_201_CREATED)
    except (RuntimeError, ValueError) as err:
        # Respond with 200 OK so the client side can read the error message.
        # TODO make the client smarter
        return JsonResponse({'error': str(err)}, status=status.HTTP_200_OK)
