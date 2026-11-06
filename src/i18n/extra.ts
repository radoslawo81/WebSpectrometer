// Web-only i18n keys (not present in the original program's language files).
// Kept separate from locales/*.json to preserve provenance: the JSONs mirror
// the original program's language files verbatim, while these keys are ours.
// {path} is replaced at runtime with the translated menu path
// (Menu_Tools → Menu_Tools_TrimPoints → Menu_Tools_Trim1).
import type { LangCode } from './index'

export const EXTRA_KEYS: Record<LangCode, Record<string, string>> = {
  ENG: {
    Msg_NotCalibrated:
      'No spectrum calibration found. Wavelengths are unreliable until calibrated — use a fluorescent lamp and {path} to calibrate.',
    Msg_CalibrateNow: 'Calibrate now (436/546)',
    Msg_Ignore: 'Ignore',
    Menu_Help_GitHubReadme: 'README on GitHub',
    btn_Fwhm: 'FWHM',
    Tip_Fwhm: 'Full width at half maximum of peaks',
    btn_ListCameras: 'Show cameras',
    Tip_ListCameras: 'Allow camera access so the browser lists all cameras (USB spectrometers included)',
    Msg_CameraDenied: 'Camera access blocked. Allow it for this site in the browser (camera icon in the address bar) and, on macOS, in System Settings → Privacy & Security → Camera for your browser.',
    Msg_CameraNotFound: 'No camera found. Check the USB cable/hub and that the camera works in another app (e.g. QuickTime / Camera app).',
    Msg_CameraBusy: 'The camera is in use by another program. Close it (FireCapture, OBS, Zoom, …) and try again.',
    Msg_CameraError: 'Could not open the camera.',
  },
  CHI: {
    Msg_NotCalibrated: '检测到尚未进行光谱校准。未校准的光谱波长不可信,建议使用荧光灯光源执行 {path} 完成校准。',
    Msg_CalibrateNow: '立即校准 (436/546)',
    Msg_Ignore: '忽略',
    Menu_Help_GitHubReadme: 'GitHub 上的 README',
    btn_Fwhm: 'FWHM',
    Tip_Fwhm: '峰的半高全宽',
    btn_ListCameras: '显示摄像头',
    Tip_ListCameras: '允许访问摄像头，以便浏览器列出所有摄像头（包括USB光谱仪）',
    Msg_CameraDenied: '摄像头访问被阻止。请在浏览器中允许此网站访问（地址栏的摄像头图标），在 macOS 上还需在 系统设置 → 隐私与安全性 → 摄像头 中允许浏览器。',
    Msg_CameraNotFound: '未找到摄像头。请检查USB线/集线器，并确认摄像头在其他应用中可用。',
    Msg_CameraBusy: '摄像头正被其他程序占用。请关闭该程序后重试。',
    Msg_CameraError: '无法打开摄像头。',
  },
  CHT: {
    Msg_NotCalibrated: '偵測到尚未進行光譜校準。未校準的光譜波長不可信,建議使用螢光燈光源執行 {path} 完成校準。',
    Msg_CalibrateNow: '立即校準 (436/546)',
    Msg_Ignore: '忽略',
    Menu_Help_GitHubReadme: 'GitHub 上的 README',
    btn_Fwhm: 'FWHM',
    Tip_Fwhm: '峰的半高全寬',
    btn_ListCameras: '顯示攝影機',
    Tip_ListCameras: '允許存取攝影機，以便瀏覽器列出所有攝影機（包括USB光譜儀）',
    Msg_CameraDenied: '攝影機存取被封鎖。請在瀏覽器中允許此網站存取（網址列的攝影機圖示），在 macOS 上還需在 系統設定 → 隱私權與安全性 → 相機 中允許瀏覽器。',
    Msg_CameraNotFound: '找不到攝影機。請檢查USB線/集線器，並確認攝影機在其他應用程式中可用。',
    Msg_CameraBusy: '攝影機正被其他程式使用。請關閉該程式後重試。',
    Msg_CameraError: '無法開啟攝影機。',
  },
  ITA: {
    Msg_NotCalibrated:
      "Nessuna calibrazione dello spettro trovata. Le lunghezze d'onda non sono affidabili finché non si calibra — usa una lampada fluorescente ed esegui {path} per calibrare.",
    Msg_CalibrateNow: 'Calibra ora (436/546)',
    Msg_Ignore: 'Ignora',
    Menu_Help_GitHubReadme: 'README su GitHub',
    btn_Fwhm: 'FWHM',
    Tip_Fwhm: 'Larghezza a metà altezza dei picchi',
    btn_ListCameras: 'Mostra fotocamere',
    Tip_ListCameras: 'Consenti l\'accesso alla fotocamera perché il browser elenchi tutte le fotocamere (anche spettrometri USB)',
    Msg_CameraDenied: 'Accesso alla fotocamera bloccato. Consentilo per questo sito nel browser (icona della fotocamera nella barra degli indirizzi) e, su macOS, in Impostazioni di Sistema → Privacy e sicurezza → Fotocamera.',
    Msg_CameraNotFound: 'Nessuna fotocamera trovata. Controlla il cavo/hub USB e che la fotocamera funzioni in un\'altra app.',
    Msg_CameraBusy: 'La fotocamera è usata da un altro programma. Chiudilo e riprova.',
    Msg_CameraError: 'Impossibile aprire la fotocamera.',
  },
  FRA: {
    Msg_NotCalibrated:
      "Aucune calibration du spectre détectée. Les longueurs d'onde ne sont pas fiables tant que l'appareil n'est pas calibré — utilisez une lampe fluorescente et exécutez {path} pour calibrer.",
    Msg_CalibrateNow: 'Calibrer maintenant (436/546)',
    Msg_Ignore: 'Ignorer',
    Menu_Help_GitHubReadme: 'README sur GitHub',
    btn_Fwhm: 'FWHM',
    Tip_Fwhm: 'Largeur à mi-hauteur des pics',
    btn_ListCameras: 'Afficher les caméras',
    Tip_ListCameras: 'Autoriser l\'accès à la caméra pour que le navigateur liste toutes les caméras (y compris les spectromètres USB)',
    Msg_CameraDenied: 'Accès à la caméra bloqué. Autorisez-le pour ce site dans le navigateur (icône caméra dans la barre d\'adresse) et, sous macOS, dans Réglages Système → Confidentialité et sécurité → Caméra.',
    Msg_CameraNotFound: 'Aucune caméra trouvée. Vérifiez le câble/hub USB et que la caméra fonctionne dans une autre application.',
    Msg_CameraBusy: 'La caméra est utilisée par un autre programme. Fermez-le et réessayez.',
    Msg_CameraError: 'Impossible d\'ouvrir la caméra.',
  },
  POR: {
    Msg_NotCalibrated:
      'Nenhuma calibração do espectro encontrada. Os comprimentos de onda não são confiáveis até a calibração — use uma lâmpada fluorescente e execute {path} para calibrar.',
    Msg_CalibrateNow: 'Calibrar agora (436/546)',
    Msg_Ignore: 'Ignorar',
    Menu_Help_GitHubReadme: 'README no GitHub',
    btn_Fwhm: 'FWHM',
    Tip_Fwhm: 'Largura a meia altura dos picos',
    btn_ListCameras: 'Mostrar câmeras',
    Tip_ListCameras: 'Permitir o acesso à câmera para que o navegador liste todas as câmeras (incluindo espectrômetros USB)',
    Msg_CameraDenied: 'Acesso à câmera bloqueado. Permita-o para este site no navegador (ícone da câmera na barra de endereços) e, no macOS, em Ajustes do Sistema → Privacidade e Segurança → Câmera.',
    Msg_CameraNotFound: 'Nenhuma câmera encontrada. Verifique o cabo/hub USB e se a câmera funciona em outro aplicativo.',
    Msg_CameraBusy: 'A câmera está em uso por outro programa. Feche-o e tente novamente.',
    Msg_CameraError: 'Não foi possível abrir a câmera.',
  },
}
