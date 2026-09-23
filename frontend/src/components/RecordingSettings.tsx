import React, { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { FolderOpen, MonitorUp } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { DeviceSelection, SelectedDevices } from '@/components/DeviceSelection';
import Analytics from '@/lib/analytics';
import { toast } from 'sonner';
import { useAppLanguage } from '@/contexts/AppLanguageContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';

export interface RecordingPreferences {
  save_folder: string;
  auto_save: boolean;
  transcription_enabled: boolean;
  screen_recording_enabled: boolean;
  file_format: string;
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
}

interface RecordingSettingsProps {
  onSave?: (preferences: RecordingPreferences) => void;
}

export function RecordingSettings({ onSave }: RecordingSettingsProps) {
  const { t } = useAppLanguage();
  const { isRecording } = useRecordingState();
  const [preferences, setPreferences] = useState<RecordingPreferences>({
    save_folder: '',
    auto_save: true,
    transcription_enabled: true,
    screen_recording_enabled: false,
    file_format: 'mp4',
    preferred_mic_device: null,
    preferred_system_device: null
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showRecordingNotification, setShowRecordingNotification] = useState(true);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    import('@tauri-apps/plugin-os')
      .then(({ platform }) => setIsMac(platform() === 'macos'))
      .catch(() => setIsMac(false));
  }, []);

  // Load recording preferences on component mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await invoke<RecordingPreferences>('get_recording_preferences');
        setPreferences(prefs);
      } catch (error) {
        console.error('Failed to load recording preferences:', error);
        // If loading fails, get default folder path
        try {
          const defaultPath = await invoke<string>('get_default_recordings_folder_path');
          setPreferences(prev => ({ ...prev, save_folder: defaultPath }));
        } catch (defaultError) {
          console.error('Failed to get default folder path:', defaultError);
        }
      } finally {
        setLoading(false);
      }
    };

    loadPreferences();
  }, []);

  // Load recording notification preference
  useEffect(() => {
    const loadNotificationPref = async () => {
      try {
        const { Store } = await import('@tauri-apps/plugin-store');
        const store = await Store.load('preferences.json');
        const show = await store.get<boolean>('show_recording_notification') ?? true;
        setShowRecordingNotification(show);
      } catch (error) {
        console.error('Failed to load notification preference:', error);
      }
    };
    loadNotificationPref();
  }, []);

  const handleAutoSaveToggle = async (enabled: boolean) => {
    if (!enabled && !preferences.transcription_enabled) {
      toast.error(t('recordingModeRequired'));
      return;
    }
    const newPreferences = { ...preferences, auto_save: enabled };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);

    // Track auto-save setting change
    await Analytics.track('auto_save_recording_toggled', {
      enabled: enabled.toString()
    });
  };

  const handleTranscriptionToggle = async (enabled: boolean) => {
    if (!enabled && !preferences.auto_save) {
      toast.error(t('recordingModeRequired'));
      return;
    }
    const newPreferences = { ...preferences, transcription_enabled: enabled };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);
    await Analytics.track('live_transcription_toggled', { enabled: enabled.toString() });
  };

  const handleScreenRecordingToggle = async (enabled: boolean) => {
    const newPreferences = { ...preferences, screen_recording_enabled: enabled };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);
    await Analytics.track('screen_recording_toggled', { enabled: enabled.toString() });
  };

  const handleDeviceChange = async (devices: SelectedDevices) => {
    const newPreferences = {
      ...preferences,
      preferred_mic_device: devices.micDevice,
      preferred_system_device: devices.systemDevice
    };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);

    // Track default device preference changes
    // Note: Individual device selection analytics are tracked in DeviceSelection component
    await Analytics.track('default_devices_changed', {
      has_preferred_microphone: (!!devices.micDevice).toString(),
      has_preferred_system_audio: (!!devices.systemDevice).toString()
    });
  };

  const handleOpenFolder = async () => {
    try {
      await invoke('open_recordings_folder');
    } catch (error) {
      console.error('Failed to open recordings folder:', error);
    }
  };

  const handleNotificationToggle = async (enabled: boolean) => {
    try {
      setShowRecordingNotification(enabled);
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('preferences.json');
      await store.set('show_recording_notification', enabled);
      await store.save();
      toast.success(t('preferenceSaved'));
      await Analytics.track('recording_notification_preference_changed', {
        enabled: enabled.toString()
      });
    } catch (error) {
      console.error('Failed to save notification preference:', error);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const savePreferences = async (prefs: RecordingPreferences) => {
    setSaving(true);
    try {
      await invoke('set_recording_preferences', { preferences: prefs });
      onSave?.(prefs);
      window.dispatchEvent(new CustomEvent('recording-preferences-updated', { detail: prefs }));

      // Show success toast with device details
      const micDevice = prefs.preferred_mic_device || t('defaultDevice');
      const systemDevice = prefs.preferred_system_device || t('defaultDevice');
      toast.success(t('devicePreferencesSaved'), {
        description: `${t('microphone')}: ${micDevice}，${t('systemAudio')}: ${systemDevice}`
      });
    } catch (error) {
      console.error('Failed to save recording preferences:', error);
      toast.error(error instanceof Error ? error.message : String(error), {
        description: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="h-8 bg-gray-200 rounded mb-4"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">{t('recordingSettings')}</h3>
        <p className="text-sm text-gray-600 mb-6">
          {t('recordingSettingsDescription')}
        </p>
      </div>

      {/* Auto Save Toggle */}
      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div className="flex-1">
          <div className="font-medium">{t('saveAudioRecordings')}</div>
          <div className="text-sm text-gray-600">
            {t('saveAudioDescription')}
          </div>
        </div>
        <Switch
          checked={preferences.auto_save}
          onCheckedChange={handleAutoSaveToggle}
          disabled={saving || isRecording || (preferences.auto_save && !preferences.transcription_enabled)}
        />
      </div>

      {isMac && (
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="flex min-w-0 flex-1 items-start gap-3 pr-6">
            <MonitorUp className="mt-0.5 h-5 w-5 shrink-0 text-gray-500" aria-hidden="true" />
            <div>
              <div className="font-medium">{t('recordScreen')}</div>
              <div className="text-sm text-gray-600">{t('recordScreenDescription')}</div>
            </div>
          </div>
          <Switch
            checked={preferences.screen_recording_enabled}
            onCheckedChange={handleScreenRecordingToggle}
            disabled={saving || isRecording}
            aria-label={t('recordScreen')}
          />
        </div>
      )}

      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div className="flex-1 min-w-0 pr-6">
          <div className="font-medium">{t('liveTranscription')}</div>
          <div className="text-sm text-gray-600">{t('liveTranscriptionDescription')}</div>
        </div>
        <Switch
          checked={preferences.transcription_enabled}
          onCheckedChange={handleTranscriptionToggle}
          disabled={saving || isRecording || (preferences.transcription_enabled && !preferences.auto_save)}
        />
      </div>

      {!preferences.transcription_enabled && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          {t('transcriptionDisabled')}
        </div>
      )}

      {isRecording && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {t('recordingSettingsLocked')}
        </div>
      )}

      {/* Screen video uses the same meeting folder even when audio saving is off. */}
      {(preferences.auto_save || (isMac && preferences.screen_recording_enabled)) && (
        <div className="space-y-4">
          <div className="p-4 border rounded-lg bg-gray-50">
            <div className="font-medium mb-2">{t('saveLocation')}</div>
            <div className="text-sm text-gray-600 mb-3 break-all">
              {preferences.save_folder || t('defaultFolder')}
            </div>
            <button
              onClick={handleOpenFolder}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              {t('openFolder')}
            </button>
          </div>

          <div className="p-4 border rounded-lg bg-blue-50">
            <div className="text-sm text-blue-800">
              <strong>{t('fileFormat')}:</strong> {preferences.file_format.toUpperCase()} {t('files')}
            </div>
            <div className="text-xs text-blue-600 mt-1">
              {t('recordingsSavedWithTimestamp')}
            </div>
          </div>
        </div>
      )}

      {/* Info when auto_save is disabled */}
      {!preferences.auto_save && (
        <div className="p-4 border rounded-lg bg-yellow-50">
          <div className="text-sm text-yellow-800">
            {t('audioRecordingDisabled')}
          </div>
        </div>
      )}

      {/* Recording Notification Toggle */}
      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div className="flex-1">
          <div className="font-medium">{t('recordingStartNotification')}</div>
          <div className="text-sm text-gray-600">
            {t('recordingStartNotificationDescription')}
          </div>
        </div>
        <Switch
          checked={showRecordingNotification}
          onCheckedChange={handleNotificationToggle}
        />
      </div>

      {/* Device Preferences */}
      <div className="space-y-4">
        <div className="border-t pt-6">
          <h4 className="text-base font-medium text-gray-900 mb-4">{t('defaultAudioDevices')}</h4>
          <p className="text-sm text-gray-600 mb-4">
            {t('defaultAudioDevicesDescription')}
          </p>

          <div className="border rounded-lg p-4 bg-gray-50">
            <DeviceSelection
              selectedDevices={{
                micDevice: preferences.preferred_mic_device,
                systemDevice: preferences.preferred_system_device
              }}
              onDeviceChange={handleDeviceChange}
              disabled={saving}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
