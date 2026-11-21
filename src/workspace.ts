import type { Format } from './formats';

export interface Tab {
  id: string;
  name: string;
  format: Format;
  bytes: Uint8Array;
  blank?: boolean;
  dirty: boolean;
}

export interface SavedFile {
  bytes: Uint8Array;
  name: string;
  dirty?: boolean;
}

export interface EditorProps {
  tab: Tab;
  active: boolean;
  onDirty: (dirty: boolean) => void;
  setSave: (save?: () => Promise<SavedFile>) => void;
  requestSave: () => void;
}
