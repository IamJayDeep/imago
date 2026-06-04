import { create } from "zustand";

export interface FileItem {
  path: string;
  name: string;
  size: number | null;
  status: "pending" | "processing" | "success" | "error";
  progress: number;
  message: string;
}

export interface ConvertSettings {
  format: "png" | "jpeg" | "webp" | "avif";
  quality: number;
}

export interface CropRotateSettings {
  rotation: "0" | "90" | "180" | "270" | "auto";
  cropEnabled: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResizeSettings {
  method: "exact" | "percentage" | "max_bounds";
  width: number;
  height: number;
  percentage: number;
}

export interface MetadataSettings {
  action: "read" | "strip" | "update";
  updates: Record<string, string>;
}

export interface TextWatermarkConfig {
  text: string;
  fontSize: number;
  color: string;
  opacity: number;
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
}

export interface ImageWatermarkConfig {
  path: string;
  opacity: number;
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  scale: number;
}

export interface WatermarkSettings {
  watermarkType: "text" | "image";
  textConfig: TextWatermarkConfig;
  imageConfig: ImageWatermarkConfig;
}

export type ActiveTab = "convert" | "crop-rotate" | "resize" | "metadata" | "watermark";

interface AppState {
  files: FileItem[];
  activeTab: ActiveTab;
  outputDir: string;
  isProcessing: boolean;
  
  // Tool configurations
  convertSettings: ConvertSettings;
  cropRotateSettings: CropRotateSettings;
  resizeSettings: ResizeSettings;
  metadataSettings: MetadataSettings;
  watermarkSettings: WatermarkSettings;
  
  // Actions
  addFiles: (filePaths: string[]) => void;
  removeFile: (filePath: string) => void;
  clearQueue: () => void;
  setOutputDir: (dir: string) => void;
  setActiveTab: (tab: ActiveTab) => void;
  
  // Config setters
  setConvertSettings: (settings: Partial<ConvertSettings>) => void;
  setCropRotateSettings: (settings: Partial<CropRotateSettings>) => void;
  setResizeSettings: (settings: Partial<ResizeSettings>) => void;
  setMetadataSettings: (settings: Partial<MetadataSettings>) => void;
  setWatermarkSettings: (settings: Partial<WatermarkSettings>) => void;
  
  // Processing actions
  startProcessing: () => void;
  updateFileProgress: (
    filePath: string,
    status: FileItem["status"],
    message: string
  ) => void;
  finishProcessing: () => void;
}

// Helpers
const getFileName = (path: string): string => {
  // Handles both Windows and Unix path separators
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
};

export const useAppStore = create<AppState>((set) => ({
  files: [],
  activeTab: "convert",
  outputDir: "",
  isProcessing: false,

  convertSettings: {
    format: "jpeg",
    quality: 85,
  },
  cropRotateSettings: {
    rotation: "0",
    cropEnabled: false,
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  },
  resizeSettings: {
    method: "max_bounds",
    width: 1920,
    height: 1080,
    percentage: 50,
  },
  metadataSettings: {
    action: "read",
    updates: {},
  },
  watermarkSettings: {
    watermarkType: "text",
    textConfig: {
      text: "Imago Watermark",
      fontSize: 24,
      color: "#ffffff",
      opacity: 0.5,
      position: "bottom-right",
    },
    imageConfig: {
      path: "",
      opacity: 0.5,
      position: "bottom-right",
      scale: 0.2,
    },
  },

  addFiles: (filePaths) =>
    set((state) => {
      // Filter out files already in the queue
      const existingPaths = new Set(state.files.map((f) => f.path));
      const newFiles = filePaths
        .filter((path) => !existingPaths.has(path))
        .map((path) => ({
          path,
          name: getFileName(path),
          size: null, // Size will be retrieved later or left null
          status: "pending" as const,
          progress: 0,
          message: "Ready",
        }));
      return { files: [...state.files, ...newFiles] };
    }),

  removeFile: (filePath) =>
    set((state) => ({
      files: state.files.filter((f) => f.path !== filePath),
    })),

  clearQueue: () =>
    set(() => ({
      files: [],
      isProcessing: false,
    })),

  setOutputDir: (dir) => set(() => ({ outputDir: dir })),
  
  setActiveTab: (tab) => set(() => ({ activeTab: tab })),

  setConvertSettings: (settings) =>
    set((state) => ({
      convertSettings: { ...state.convertSettings, ...settings },
    })),

  setCropRotateSettings: (settings) =>
    set((state) => ({
      cropRotateSettings: { ...state.cropRotateSettings, ...settings },
    })),

  setResizeSettings: (settings) =>
    set((state) => ({
      resizeSettings: { ...state.resizeSettings, ...settings },
    })),

  setMetadataSettings: (settings) =>
    set((state) => ({
      metadataSettings: { ...state.metadataSettings, ...settings },
    })),

  setWatermarkSettings: (settings) =>
    set((state) => ({
      watermarkSettings: { ...state.watermarkSettings, ...settings },
    })),

  startProcessing: () =>
    set((state) => ({
      isProcessing: true,
      files: state.files.map((file) => ({
        ...file,
        status: "pending",
        progress: 0,
        message: "Waiting...",
      })),
    })),

  updateFileProgress: (filePath, status, message) =>
    set((state) => ({
      files: state.files.map((file) => {
        if (file.path === filePath) {
          const progress = status === "success" || status === "error" ? 100 : 50;
          return { ...file, status, progress, message };
        }
        return file;
      }),
    })),

  finishProcessing: () => set(() => ({ isProcessing: false })),
}));
