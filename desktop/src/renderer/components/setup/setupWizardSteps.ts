export type VideoSetupWizardStepId = 'video-welcome' | 'obs-websocket' | 'obs-replay' | 'folders' | 'trade-source' | 'test-clip' | 'video-done'
export type ProxySetupWizardStepId = 'proxy-welcome' | 'proxy-server' | 'proxy-chain' | 'proxy-check' | 'proxy-done'
export type SetupWizardStepId = VideoSetupWizardStepId | ProxySetupWizardStepId

export type SetupWizardStep = {
  id: SetupWizardStepId
  title: string
  goal: string
  actions: string[]
}

export const videoSetupWizardSteps: SetupWizardStep[] = [
  {
    id: 'video-welcome',
    title: 'Быстрый старт видео',
    goal: 'За 5-10 минут настроить OBS, папки и тестовый клип, чтобы TradeTools мог сохранять записи сделок.',
    actions: [
      'Проверим OBS WebSocket',
      'Укажем папку OBS replay и папку готовых клипов',
      'Добавим read-only API ключи Binance Futures',
      'Сделаем тестовый клип перед подключением Binance Futures'
    ]
  },
  {
    id: 'obs-websocket',
    title: 'Подключите OBS WebSocket',
    goal: 'TradeTools должен уметь отправлять OBS команду SaveReplayBuffer.',
    actions: [
      'Откройте OBS -> Tools -> WebSocket Server Settings',
      'Включите Enable WebSocket server',
      'Оставьте host 127.0.0.1 и порт 4455 или впишите свои значения ниже',
      'Введите пароль OBS WebSocket, он сохранится в системном keychain'
    ]
  },
  {
    id: 'obs-replay',
    title: 'Включите Replay Buffer в OBS',
    goal: 'OBS должен держать последние минуты записи в памяти, чтобы после закрытия сделки сохранить нужный фрагмент.',
    actions: [
      'OBS -> Settings -> Output -> Replay Buffer',
      'Включите Replay Buffer и поставьте длительность больше максимальной сделки',
      'Перед торговлей нажмите Start Replay Buffer',
      'После настройки нажмите проверку видео'
    ]
  },
  {
    id: 'folders',
    title: 'Укажите папки и отступы клипа',
    goal: 'Приложение должно знать, где искать replay-файлы OBS и куда складывать готовые MP4 + JSON.',
    actions: [
      'Папка OBS replay должна совпадать с Recording Path в OBS',
      'Папка клипов: место для готовых обрезанных видео',
      'Отступ до входа и после выхода добавляет запас по краям сделки'
    ]
  },
  {
    id: 'trade-source',
    title: 'API-ключи Binance Futures',
    goal: 'Добавьте read-only API Key и Secret, чтобы TradeTools отслеживал закрытие futures-позиций.',
    actions: [
      'Создайте API Key в Binance с доступом только на чтение',
      'Отключите торговлю, вывод средств и любые лишние разрешения',
      'После сохранения ключей можно проверить подключение Binance'
    ]
  },
  {
    id: 'test-clip',
    title: 'Создайте тестовый клип',
    goal: 'Проверить весь локальный pipeline до подключения реальных сделок.',
    actions: [
      'TradeTools отправит SaveReplayBuffer в OBS',
      'Найдет свежий replay-файл в папке OBS replay',
      'Обрежет его через ffmpeg по тестовой сделке BTCUSDT',
      'Добавит клип в очередь проверки'
    ]
  },
  {
    id: 'video-done',
    title: 'Видео готово к работе',
    goal: 'Локальная часть настроена: OBS сохраняет replay, ffmpeg режет клип, очередь проверки показывает результат.',
    actions: [
      'Перед торговлей убедитесь, что OBS и Replay Buffer запущены',
      'Дальше можно подключать Binance Futures',
      'Если что-то сломается, снова откройте настройку видео сверху'
    ]
  }
]

export const proxySetupWizardSteps: SetupWizardStep[] = [
  {
    id: 'proxy-welcome',
    title: 'Быстрый старт прокси',
    goal: 'Добавить серверы, сохранить доступы, собрать цепочку и получить настройки для торгового терминала.',
    actions: [
      'Добавим сервер с IP, SSH-логином, паролем и ссылкой на хостинг',
      'Соберём порядок связки после добавления всех серверов',
      'Проверим SSH-доступы и получим инструкцию для терминала'
    ]
  },
  {
    id: 'proxy-server',
    title: 'Добавьте сервер',
    goal: 'Сохраните один сервер или первый узел будущей цепочки. Пароль уйдет в системный keychain.',
    actions: [
      'Введите понятное название сервера',
      'Укажите IP или домен сервера',
      'Введите SSH-логин, SSH-пароль, сайт хостинга и число оплаты'
    ]
  },
  {
    id: 'proxy-chain',
    title: 'Соберите цепочку',
    goal: 'Если серверов несколько, задайте порядок отдельным списком на странице прокси после добавления всех узлов.',
    actions: [
      'Закройте мастер или перейдите в раздел прокси',
      'В блоке "Порядок связки" перетащите серверы в нужной очередности',
      'Сохраните порядок и запустите проверку связки'
    ]
  },
  {
    id: 'proxy-check',
    title: 'Проверьте подключение',
    goal: 'TradeTools подключится по SSH к каждому серверу цепочки и подготовит настройки для торгового терминала.',
    actions: [
      'Выберите первый сервер маршрута',
      'Запустите проверку SSH',
      'Скопируйте настройки 127.0.0.1 и локального порта в торговый терминал'
    ]
  },
  {
    id: 'proxy-done',
    title: 'Прокси готовы',
    goal: 'Серверы сохранены, оплаты контролируются, а цепочка проверяется отдельной кнопкой в разделе прокси.',
    actions: [
      'Shadowsocks и Throne для автоматической схемы не нужны',
      'Терминал использует обычный HTTP proxy 127.0.0.1 и локальный порт',
      'При оплате используйте кнопку открытия сайта хостинга'
    ]
  }
]

export const setupWizardSteps = videoSetupWizardSteps
