// Video Input Device panel (§6.1): device dropdown, read-only resolution/FPS, Connect/Disconnect
import { useEffect, useState } from 'react'
import { setSettings, useAppState } from '../app/store'
import { useT } from '../i18n'
import { connectCamera } from '../app/engine'
import { devicesNeedPermission, listVideoDevices, requestVideoDevices } from '../camera/capture'
import { ConnectButton } from '../components/ConnectButton'
import { ToggleButton } from '../components/ToggleButton'

// Web-only: map getUserMedia errors to a short hint key
function cameraErrorKey(e: unknown): string {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Msg_CameraDenied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Msg_CameraNotFound'
  if (name === 'NotReadableError' || name === 'AbortError') return 'Msg_CameraBusy'
  return 'Msg_CameraError'
}

export function VideoInputPanel() {
  const { settings, runtime } = useAppState()
  const t = useT()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [error, setError] = useState<string>('')

  useEffect(() => {
    void listVideoDevices().then(setDevices)
    const onChange = () => void listVideoDevices().then(setDevices)
    navigator.mediaDevices.addEventListener('devicechange', onChange)
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange)
  }, [runtime.connected])

  const deviceIdx = Number.parseInt(settings.VideoInDevice, 10) || 0
  const needPermission = devicesNeedPermission(devices)

  const unlockDevices = async () => {
    setError('')
    try {
      setDevices(await requestVideoDevices())
    } catch (e) {
      setError(t(cameraErrorKey(e)))
    }
  }

  const connect = async () => {
    setError('')
    try {
      await connectCamera()
    } catch (e) {
      // Shown inline below the panel instead of ConnectButton's alert()
      if ((e as Error)?.message !== 'connect cancelled') setError(t(cameraErrorKey(e)))
    }
  }

  return (
    <div className="group-box">
      <div className="group-box-title">{t('GroupBox_VideoInDevice')}</div>
      <div className="field-row">
        <select
          style={{ flex: 1, minWidth: 0 }}
          value={deviceIdx}
          onChange={(e) => setSettings({ VideoInDevice: e.target.value })}
        >
          {devices.length === 0 && <option value={0}>0 (camera)</option>}
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={i}>
              {i} {d.label || `Camera ${i}`}
            </option>
          ))}
        </select>
        {needPermission && (
          <ToggleButton active={false} title={t('Tip_ListCameras')} onClick={() => void unlockDevices()}>
            {t('btn_ListCameras')}
          </ToggleButton>
        )}
      </div>
      <div className="field-row">
        <input className="text-box" readOnly value={runtime.resolution} style={{ width: 90 }} />
        <input className="text-box" readOnly value={runtime.fps ? `${runtime.fps}` : ''} style={{ width: 50 }} />
        <div style={{ flex: 1 }} />
        <ConnectButton connect={connect} />
      </div>
      {error && <div style={{ color: 'rgb(190,0,0)', fontSize: 11, marginTop: 2 }}>{error}</div>}
    </div>
  )
}
