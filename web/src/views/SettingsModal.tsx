// Settings modal (M11) - the knobs the legacy jQuery UI had (number format, items-per-row) that the
// Preact rewrite dropped, plus the freshness/density hooks this milestone introduces. One modal rather
// than scattering controls across the shell, so later slices have one place to add to.
import { DEFAULT_SETTINGS, TILE_MIN_RANGE, usePrefs } from "../state/prefs";
import type { Settings } from "../state/prefs";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Modal } from "../ui/Modal";
import type { SegmentedOption } from "../ui/SegmentedControl";
import { SegmentedControl } from "../ui/SegmentedControl";

export interface SettingsModalProps {
    onClose: () => void;
    /** Notify-on-completion moved here from the sidebar (M11) - state/prefs.tsx still owns the value and
     *  persistence; App.tsx still owns the lazy `Notification.requestPermission()` call on enabling. */
    notifyEnabled: boolean;
    onToggleNotify: () => void;
}

const NUMBER_FORMAT_OPTIONS: SegmentedOption<Settings["numberFormat"]>[] = [
    { value: "full", label: "Full (1,204,532)" },
    { value: "compact", label: "Compact (1.2M)" },
];

const DENSITY_OPTIONS: SegmentedOption<Settings["density"]>[] = [
    { value: "comfortable", label: "Comfortable" },
    { value: "compact", label: "Compact" },
];

const AUTO_REFRESH_OPTIONS: SegmentedOption<Settings["autoRefreshItems"]>[] = [
    { value: "off", label: "Off" },
    { value: "15s", label: "15s" },
    { value: "30s", label: "30s" },
    { value: "60s", label: "60s" },
];

export function SettingsModal({ onClose, notifyEnabled, onToggleNotify }: SettingsModalProps) {
    const { settings, setSettings } = usePrefs();

    return (
        <Modal
            onClose={onClose}
            width={440}
            title="Settings"
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={() => setSettings(() => ({ ...DEFAULT_SETTINGS }))}>
                        Reset to defaults
                    </Button>
                    <Button variant="primary" onClick={onClose}>
                        Done
                    </Button>
                </>
            }
        >
            <div className="settings">
                <div className="settings__row">
                    <span className="settings__label">Number format</span>
                    <SegmentedControl
                        options={NUMBER_FORMAT_OPTIONS}
                        value={settings.numberFormat}
                        onChange={(numberFormat) => setSettings((s) => ({ ...s, numberFormat }))}
                    />
                </div>

                <div className="settings__row">
                    <span className="settings__label">Density</span>
                    <SegmentedControl
                        options={DENSITY_OPTIONS}
                        value={settings.density}
                        onChange={(density) => setSettings((s) => ({ ...s, density }))}
                    />
                </div>

                <div className="settings__row">
                    <span className="settings__label">Item tile size</span>
                    <div className="settings__slider">
                        <input
                            type="range"
                            min={TILE_MIN_RANGE.min}
                            max={TILE_MIN_RANGE.max}
                            step={10}
                            value={settings.tileMin}
                            onInput={(e) => {
                                const tileMin = Number((e.target as HTMLInputElement).value);
                                setSettings((s) => ({ ...s, tileMin }));
                            }}
                        />
                        <span className="settings__value">{settings.tileMin}px</span>
                    </div>
                </div>

                <div className="settings__row">
                    <span className="settings__label">Auto-refresh items</span>
                    <SegmentedControl
                        options={AUTO_REFRESH_OPTIONS}
                        value={settings.autoRefreshItems}
                        onChange={(autoRefreshItems) => setSettings((s) => ({ ...s, autoRefreshItems }))}
                    />
                </div>

                <div className="settings__row">
                    <Checkbox checked={notifyEnabled} onChange={onToggleNotify}>
                        <span className="settings__checkbox-label">Notify on job completion</span>
                    </Checkbox>
                </div>
            </div>
        </Modal>
    );
}
