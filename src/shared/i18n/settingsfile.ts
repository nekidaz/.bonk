// The settings.json tab and its toasts (issue #2).
export const ru = {
  'settingsFile.open': 'Открыть settings.json',
  'settingsFile.external': 'Во внешнем редакторе',
  'settingsFile.revert': 'Отменить правки',
  'settingsFile.unsavedEdits': 'Есть несохранённые правки',
  'settingsFile.applied': 'Применено',
  'settingsFile.validUnsaved': 'JSON валиден · {keys} — сохранить и применить',
  'settingsFile.problems': 'предупреждений: {n}',
  'settingsFile.unknown': 'Неизвестная настройка «{key}» — bonk её не читает',
  'settingsFile.invalid': 'Недопустимое значение «{key}» — действует значение по умолчанию',
  'settingsFile.notObject': 'settings.json должен быть JSON-объектом { … }',
  'settingsFile.completionHint': 'Ctrl+Space — все настройки',
  'settingsFile.broken': 'settings.json не прочитан: {error}. Изменения не сохраняются, пока файл не исправлен',
};
export const en: Record<keyof typeof ru, string> = {
  'settingsFile.open': 'Open settings.json',
  'settingsFile.external': 'In external editor',
  'settingsFile.revert': 'Discard edits',
  'settingsFile.unsavedEdits': 'Unsaved edits',
  'settingsFile.applied': 'Applied',
  'settingsFile.validUnsaved': 'Valid JSON · {keys} to save and apply',
  'settingsFile.problems': 'warnings: {n}',
  'settingsFile.unknown': 'Unknown setting “{key}”: bonk ignores it',
  'settingsFile.invalid': 'Invalid value for “{key}”: the default applies',
  'settingsFile.notObject': 'settings.json must be a JSON object { … }',
  'settingsFile.completionHint': 'Ctrl+Space: all settings',
  'settingsFile.broken': 'settings.json not read: {error}. Changes are not saved until the file is fixed',
};
