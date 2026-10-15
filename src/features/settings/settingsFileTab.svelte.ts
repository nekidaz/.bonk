import { tabs } from '$entities/tab';
import { settingsFile } from '$shared/persist';
import type { Tab } from '$shared/model';

/** The settings.json tab's unsaved text; null = it shows the file as it is (and follows it). */
class SettingsDraft {
  text = $state<string | null>(null);
}
export const settingsDraft = new SettingsDraft();

/** Open (or focus) the single settings.json tab. Like the Environments tab: no request, not restored. */
export function openSettingsFileTab(): void {
  const existing = tabs.list.find((t) => t.protocol === 'settings');
  if (existing) {
    tabs.activeId = existing.id;
    return;
  }
  const tab: Tab = {
    id: crypto.randomUUID(),
    protocol: 'settings',
    title: 'settings.json',
    manualTitle: true,
    request: { method: 'JSON', url: '', headers: {} },
  };
  tabs.update((list) => [...list, tab]);
  tabs.activeId = tab.id;
}

/** ⌘S in the tab: write the draft to the file and apply it. Throws when the write fails. */
export async function saveSettingsDraft(): Promise<void> {
  const text = settingsDraft.text;
  if (text === null) return;
  await settingsFile.saveText(text);
  settingsDraft.text = null;
}
