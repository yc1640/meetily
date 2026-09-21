import React from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { UpdateInfo } from '@/services/updateService';

let globalShowDialogCallback: (() => void) | null = null;

interface UpdateNotificationLabels {
  title: string;
  description: string;
  action: string;
}

export function setUpdateDialogCallback(callback: () => void) {
  globalShowDialogCallback = callback;
}

export function showUpdateNotification(
  updateInfo: UpdateInfo,
  onUpdateClick?: () => void,
  labels?: UpdateNotificationLabels,
) {
  const handleClick = () => {
    if (onUpdateClick) {
      onUpdateClick();
    } else if (globalShowDialogCallback) {
      globalShowDialogCallback();
    }
  };

  toast.info(
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <Download className="h-4 w-4" />
        <div>
          <p className="font-medium">{labels?.title || 'Update available'}</p>
          <p className="text-sm text-muted-foreground">
            {labels?.description || `Version ${updateInfo.version} is now available`}
          </p>
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleClick();
        }}
        className="text-sm font-medium text-blue-600 hover:text-blue-700 underline"
      >
        {labels?.action || 'View details'}
      </button>
    </div>,
    {
      duration: 10000,
      position: 'bottom-center',
    }
  );
}
