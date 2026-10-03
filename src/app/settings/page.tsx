import { SettingsForm } from "@/components/settings-form";
import { getSettings, SETTINGS_DEFAULTS } from "@/lib/service";
import { getSessionId } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const sessionId = await getSessionId();
  const settings = await getSettings(sessionId);

  return (
    <SettingsForm
      initial={settings}
      defaults={{ ...SETTINGS_DEFAULTS, weights: { ...SETTINGS_DEFAULTS.weights } }}
    />
  );
}