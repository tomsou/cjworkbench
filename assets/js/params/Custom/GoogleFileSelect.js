import React from 'react'
import PropTypes from 'prop-types'
import { withJsonStringValues } from '../util'

const MimeTypesString = [
  'application/vnd.google-apps.spreadsheet',
  'text/csv',
  'text/tab-separated-values',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',')


class PickerFactory {
  constructor() {
    this.picker = null
  }

  /**
   * Opens a singleton Picker, calling onPick and onCancel.
   *
   * Calls onPick({ id, name, url, mimeType, type }) or onCancel()
   * and then destroys the picker.
   *
   * Example values:
   *
   * id: `"0BS58NKO6eAjKchvRVkhpVYZFL1lSXRaa3VIbFczR0pZX4dJN"`
   * name: `"My filename"`
   * mimeType: `"application/vnd.google-apps.spreadsheet"`, `"text/csv"`
   * url: `"https://docs.google.com/.../edit?usp=drive_web"`
   *
   * If the singleton Picker is already open, this is a no-op.
   */
  open(accessToken, onPick, onCancel) {
    if (this.picker !== null) return

    const onEvent = (data) => {
      switch (data.action) {
        case 'loaded':
          break

        case 'picked':
          const { id, name, url, mimeType } = data.docs[0]
          onPick({ id, name, url, mimeType })
          this.close()
          break

        case 'cancel':
          onCancel()
          this.close()
          break

        default:
          console.log('Unhandled picker event', data)
      }
    }

    const soloView = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setIncludeFolders(true)
      .setMimeTypes(MimeTypesString)

    const teamView = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setIncludeFolders(true)
      .setEnableTeamDrives(true)
      .setMimeTypes(MimeTypesString)

    this.picker = new google.picker.PickerBuilder()
      .addView(soloView)
      .addView(teamView)
      .setOAuthToken(accessToken)
      .setCallback(onEvent)
      .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
      .setSelectableMimeTypes(MimeTypesString)
      .build()

    this.picker.setVisible(true)
  }

  /**
   * Close the singleton picker, if it is open.
   */
  close() {
    if (this.picker !== null) {
      this.picker.dispose()
      this.picker = null
    }
  }
}


let googleApiLoadedPromise = null
/**
 * Load Google APIs globally (if they haven't been loaded already); return
 * a Promise[PickerFactory] that will resolve once the Google APIs are loaded.
 *
 * This returns a new PickerFactory each call, but it only loads the global
 * `google` and `gapi` variables once.
 */
async function loadDefaultPickerFactory() {
  if (googleApiLoadedPromise === null) {
    googleApiLoadedPromise = new Promise((resolve, reject) => {
      const callbackName = `GoogleFileSelect_onload_${String(Math.random()).slice(2, 10)}`
      window[callbackName] = function() {
        delete window[callbackName]
        gapi.load('picker', function() {
          resolve()
        })
      }

      const script = document.createElement('script')
      script.async = true
      script.defer = true
      script.src = `https://apis.google.com/js/api.js?onload=${callbackName}`

      document.querySelector('head').appendChild(script)
      this.script = script
    })
  }

  await googleApiLoadedPromise
  return new PickerFactory()
}


export class GoogleFileSelect extends React.PureComponent {
  static propTypes = {
    createOauthAccessToken: PropTypes.func.isRequired, // func() => Promise[str or null]
    isReadOnly: PropTypes.bool.isRequired,
    secretName: PropTypes.string, // when this changes, call createOauthAccessToken
    value: PropTypes.shape({
      id: PropTypes.string.isRequired,
      name: PropTypes.string.isRequired,
      url: PropTypes.string.isRequired
    }), // may be empty/null
    onChange: PropTypes.func.isRequired, // func({ id, name, url }) => undefined
    loadPickerFactory: PropTypes.func, // func() => Promise[PickerFactory], default uses Google APIs
  }

  state = {
    pickerFactory: null,
    loadingAccessToken: false,
    unauthenticated: false, // true after the server says we're unauthenticated
  }

  /**
   * Return a Promise of an access token or null ("unauthenticated").
   *
   * Manages state: loadingAccessToken and unauthenticated.
   *
   * Access tokens are time-sensitive, so we can't just cache the return value:
   * we need to refresh from time to time. Simplest is to load on demand.
   *
   * Each call returns a new token. Only the most-recent returned token is
   * valid.
   */
  fetchAccessToken() {
    const secretName = this.props.secretName

    if (secretName === null) {
      this.setState({
        loadingAccessToken: false,
        unauthenticated: true,
      })
      return Promise.resolve(null)
    }

    this.setState({
      loadingAccessToken: true,
      unauthenticated: false,
    })

    return this.props.createOauthAccessToken()
      .then(accessTokenOrNull => {
        if (secretName !== this.props.secretName) {
          // avoid race: another race is happening
          return null
        }
        if (this._isUnmounted) {
          // avoid race: we're closed
          return null
        }

        this.setState({
          loadingAccessToken: false,
          unauthenticated: accessTokenOrNull === null,
        })
        return accessTokenOrNull
      })
  }

  loadPickerFactory() {
    const loadPickerFactory = this.props.loadPickerFactory || loadDefaultPickerFactory
    loadPickerFactory().then(pf => {
      if (this._isUnmounted) return
      this.setState({ pickerFactory: pf })
    })
  }

  componentDidMount() {
    this.loadPickerFactory()
  }

  componentWillUnmount() {
    if (this.state.pickerFactory) {
      this.state.pickerFactory.close()
      // we leak window.gapi, but that's probably fine
    }

    this._isUnmounted = true
  }

  openPicker = () => {
    const { pickerFactory } = this.state
    this.fetchAccessToken()
      .then(accessTokenOrNull => {
        if (accessTokenOrNull) {
          pickerFactory.open(accessTokenOrNull, this.onPick, this.onCancel)
        }
        // otherwise, we've set this.state.unauthenticated
      })
  }

  onPick = (data) => {
    this.props.onChange(data)
  }

  onCancel = () => {
    // do nothing
  }

  render() {
    const { pickerFactory, loadingAccessToken, unauthenticated } = this.state
    const { value, secretName, isReadOnly } = this.props

    const defaultFileName = ''
    const fileId = value ? (value.id || null) : null
    const fileName = value ? (value.name || defaultFileName) : defaultFileName
    const fileUrl = value ? (value.url || null) : null

    let button
    if (!isReadOnly) {
      if (loadingAccessToken || !pickerFactory) {
        button = (
          <p className="loading">Loading...</p>
        )
      } else if (unauthenticated) {
        button = (
          <p className="sign-in-error">failure: please reconnect</p>
        )
      } else if (!secretName) {
        button = (
          <p className="not-signed-in">(not signed in)</p>
        )
      } else {
        button = (
          <button
            type='button'
            className="change-file action-link"
            onClick={this.openPicker}
          >
            {fileId ? 'Change' : 'Choose'}
          </button>
        )
      }
    }

    return (
      <React.Fragment>
        <a className="file-info" title={`Open in Google Sheets: ${fileName}`} target='_blank' href={fileUrl}>{fileName}</a>
        {button}
      </React.Fragment>
    )
  }
}

export default withJsonStringValues(GoogleFileSelect, null)
