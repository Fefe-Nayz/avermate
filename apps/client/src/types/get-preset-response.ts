export type GetPresetResponse = {
    presets: Preset[];
};

export type PresetSubject = {
    name: string;
    isMainSubject?: boolean;
    isDisplaySubject?: boolean;
    coefficient?: number;
    subjects?: PresetSubject[];
};

export type Preset = {
    id: string;
    name: string;
    description: string;
    subjects: PresetSubject[];
    tags: string[];
};