import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check } from "@tauri-apps/plugin-updater";

import {
  Image as ImageIcon,
  Crop as CropIcon,
  Maximize2 as ResizeIcon,
  FileText as ExifIcon,
  Type as WatermarkIcon,
  FolderOpen,
  Play,
  Trash2,
  Plus,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";

import { useAppStore } from "./store/useAppStore";
import previewImg from "./assets/preview.png";
import "./App.css";

function App() {
  const {
    files,
    activeTab,
    outputDir,
    isProcessing,
    convertSettings,
    cropRotateSettings,
    resizeSettings,
    metadataSettings,
    watermarkSettings,
    addFiles,
    removeFile,
    clearQueue,
    setOutputDir,
    setActiveTab,
    setConvertSettings,
    setCropRotateSettings,
    setResizeSettings,
    setMetadataSettings,
    setWatermarkSettings,
    startProcessing,
    updateFileProgress,
    finishProcessing,
  } = useAppStore();

  const [dragActive, setDragActive] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // States for calculating Crop Bounding Box preview scale
  const cropImgRef = useRef<HTMLImageElement>(null);
  const [renderedSize, setRenderedSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

  const handleCropImageLoad = () => {
    if (cropImgRef.current) {
      setRenderedSize({
        width: cropImgRef.current.clientWidth,
        height: cropImgRef.current.clientHeight,
      });
      setNaturalSize({
        width: cropImgRef.current.naturalWidth,
        height: cropImgRef.current.naturalHeight,
      });
    }
  };

  // Recalculate rendered size of crop image on window resizing
  useEffect(() => {
    const handleResize = () => {
      if (cropImgRef.current) {
        setRenderedSize({
          width: cropImgRef.current.clientWidth,
          height: cropImgRef.current.clientHeight,
        });
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Recalculate size if active tab changes to crop or files change
  useEffect(() => {
    if (activeTab === "crop-rotate" && cropImgRef.current) {
      // Small timeout to allow the element to render and style to resolve
      setTimeout(() => {
        if (cropImgRef.current) {
          setRenderedSize({
            width: cropImgRef.current.clientWidth,
            height: cropImgRef.current.clientHeight,
          });
          setNaturalSize({
            width: cropImgRef.current.naturalWidth,
            height: cropImgRef.current.naturalHeight,
          });
        }
      }, 100);
    }
  }, [activeTab, files]);

  // Check for updates on mount
  useEffect(() => {
    const checkForUpdates = async () => {
      try {
        const update = await check();
        if (update && update.available) {
          setUpdateAvailable(true);
        }
      } catch (err) {
        console.log("Updater check failed silently (offline):", err);
      }
    };
    checkForUpdates();
  }, []);

  // Get default output directory on mount
  useEffect(() => {
    const fetchDefaultDir = async () => {
      try {
        const defaultDir = await invoke<string>("get_default_output_dir");
        setOutputDir(defaultDir);
      } catch (err) {
        console.error("Failed to fetch default output dir:", err);
      }
    };
    fetchDefaultDir();
  }, [setOutputDir]);

  // Set up tauri event listeners for progress streaming
  useEffect(() => {
    let unlisten: () => void;

    const setupListener = async () => {
      unlisten = await listen<{
        file_path: string;
        index: number;
        total: number;
        status: "processing" | "success" | "error";
        message: string;
      }>("process-progress", (event) => {
        const { file_path, index, total, status, message } = event.payload;
        
        updateFileProgress(file_path, status, message);

        if (index === total && (status === "success" || status === "error")) {
          setTimeout(() => {
            finishProcessing();
          }, 300);
        }
      });
    };

    setupListener();

    // Listen to native window drag/drop events
    let unlistenDragDrop: () => void;
    const setupDragDropListener = async () => {
      unlistenDragDrop = await getCurrentWindow().onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDragActive(true);
        } else if (event.payload.type === "drop") {
          setDragActive(false);
          if (event.payload.paths && event.payload.paths.length > 0) {
            addFiles(event.payload.paths);
          }
        } else if (event.payload.type === "leave") {
          setDragActive(false);
        }
      });
    };
    setupDragDropListener();

    return () => {
      if (unlisten) unlisten();
      if (unlistenDragDrop) unlistenDragDrop();
    };
  }, [updateFileProgress, finishProcessing, addFiles]);

  // Folder selector command
  const handleSelectOutput = async () => {
    try {
      const selected = await invoke<string | null>("select_output_folder");
      if (selected) {
        setOutputDir(selected);
      }
    } catch (err) {
      console.error("Failed to select folder:", err);
    }
  };

  // File selector command
  const handleSelectFiles = async () => {
    try {
      const selected = await invoke<string[] | null>("select_files");
      if (selected && selected.length > 0) {
        addFiles(selected);
      }
    } catch (err) {
      console.error("Failed to select files:", err);
    }
  };

  const getValidationError = (): string | null => {
    if (files.length === 0) return null;

    if (activeTab === "watermark") {
      if (watermarkSettings.watermarkType === "image" && !watermarkSettings.imageConfig.path) {
        return "Please select a watermark overlay image.";
      }
      if (watermarkSettings.watermarkType === "text" && !watermarkSettings.textConfig.text.trim()) {
        return "Watermark text cannot be empty.";
      }
    }
    if (activeTab === "crop-rotate" && cropRotateSettings.cropEnabled) {
      if (cropRotateSettings.width <= 0 || cropRotateSettings.height <= 0) {
        return "Crop width and height must be greater than 0.";
      }
    }
    if (activeTab === "resize") {
      if (resizeSettings.method === "percentage" && resizeSettings.percentage <= 0) {
        return "Resize percentage must be greater than 0.";
      }
      if (resizeSettings.method !== "percentage") {
        if (resizeSettings.width <= 0 && resizeSettings.height <= 0) {
          return "Resize width and height must be greater than 0.";
        }
      }
    }
    return null;
  };

  const validationError = getValidationError();

  // Start batch processing task
  const handleProcessBatch = async () => {
    if (files.length === 0 || isProcessing || validationError) return;

    startProcessing();

    // Construct the settings object based on active tab
    let settingsPayload: any = {};
    if (activeTab === "convert") {
      settingsPayload = {
        type: "Convert",
        config: {
          format: convertSettings.format,
          quality: convertSettings.quality,
        },
      };
    } else if (activeTab === "crop-rotate") {
      settingsPayload = {
        type: "CropRotate",
        config: {
          rotation: cropRotateSettings.rotation,
          crop: cropRotateSettings.cropEnabled
            ? {
                x: cropRotateSettings.x,
                y: cropRotateSettings.y,
                width: cropRotateSettings.width,
                height: cropRotateSettings.height,
              }
            : null,
        },
      };
    } else if (activeTab === "resize") {
      settingsPayload = {
        type: "Resize",
        config: {
          method: resizeSettings.method,
          width: resizeSettings.method !== "percentage" ? resizeSettings.width : null,
          height: resizeSettings.method !== "percentage" ? resizeSettings.height : null,
          percentage: resizeSettings.method === "percentage" ? resizeSettings.percentage : null,
        },
      };
    } else if (activeTab === "metadata") {
      settingsPayload = {
        type: "Metadata",
        config: {
          action: metadataSettings.action,
          updates: null, // update is simplified/removed from UI
        },
      };
    } else if (activeTab === "watermark") {
      settingsPayload = {
        type: "Watermark",
        config: {
          watermark_type: watermarkSettings.watermarkType,
          text_config:
            watermarkSettings.watermarkType === "text"
              ? {
                  text: watermarkSettings.textConfig.text,
                  font_size: watermarkSettings.textConfig.fontSize,
                  color: watermarkSettings.textConfig.color,
                  opacity: watermarkSettings.textConfig.opacity,
                  position: watermarkSettings.textConfig.position,
                }
              : null,
          image_config:
            watermarkSettings.watermarkType === "image"
              ? {
                  path: watermarkSettings.imageConfig.path,
                  opacity: watermarkSettings.imageConfig.opacity,
                  position: watermarkSettings.imageConfig.position,
                  scale: watermarkSettings.imageConfig.scale,
                }
              : null,
        },
      };
    }

    try {
      await invoke("start_batch_processing", {
        files: files.map((f) => f.path),
        outputDir,
        settings: settingsPayload,
      });
    } catch (err) {
      console.error("Batch processing failed:", err);
      finishProcessing();
    }
  };

  // Browser Drag-over handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const paths: string[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i] as any;
        if (file.path) {
          paths.push(file.path);
        }
      }
      if (paths.length > 0) {
        addFiles(paths);
      }
    }
  };

  // Calculate scaled CSS crop box style relative to the rendered image bounds
  const getCropBoxStyle = () => {
    if (
      !cropRotateSettings.cropEnabled ||
      naturalSize.width === 0 ||
      naturalSize.height === 0 ||
      renderedSize.width === 0 ||
      renderedSize.height === 0
    ) {
      return { display: "none" };
    }

    const scaleX = renderedSize.width / naturalSize.width;
    const scaleY = renderedSize.height / naturalSize.height;

    const left = cropRotateSettings.x * scaleX;
    const top = cropRotateSettings.y * scaleY;
    const width = cropRotateSettings.width * scaleX;
    const height = cropRotateSettings.height * scaleY;

    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
      border: "1.5px dashed #f4f4f5",
      boxShadow: "0 0 0 9999px rgba(9, 9, 11, 0.65)",
      position: "absolute" as const,
    };
  };

  // Helper to parse and render EXIF tags as capsules
  const renderExifCapsules = (message: string) => {
    if (!message || !message.startsWith("EXIF_READ:")) return null;

    try {
      const rawJson = message.substring("EXIF_READ:".length);
      const tags = JSON.parse(rawJson);

      if (
        tags.error ||
        Object.keys(tags).length === 0 ||
        (Object.keys(tags).length === 1 && tags.error)
      ) {
        return (
          <span className="inline-block mt-2 text-[9px] text-zinc-500 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded font-medium">
            No EXIF Metadata
          </span>
        );
      }

      const targetTags = [
        { key: "Model", label: "Model" },
        { key: "DateTime", label: "Date" },
        { key: "ISOSpeedRatings", label: "ISO" },
        { key: "FNumber", label: "Aperture" },
        { key: "ExposureTime", label: "Shutter" },
      ];

      const foundTags: { label: string; value: string }[] = [];

      for (const target of targetTags) {
        const matchingKey = Object.keys(tags).find((k) =>
          k.toLowerCase().includes(target.key.toLowerCase())
        );
        if (matchingKey && tags[matchingKey]) {
          let val = tags[matchingKey];
          if (target.key === "DateTime" && val.length > 10) {
            val = val.substring(0, 10).replace(/:/g, "-");
          }
          foundTags.push({ label: target.label, value: val });
        }
      }

      if (foundTags.length === 0) {
        return (
          <span className="inline-block mt-2 text-[9px] text-zinc-400 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded font-medium">
            EXIF Metadata Present
          </span>
        );
      }

      return (
        <div className="flex flex-wrap gap-1 mt-2">
          {foundTags.slice(0, 3).map((tag) => (
            <span
              key={tag.label}
              className="text-[9px] bg-zinc-900 text-zinc-300 px-1.5 py-0.5 rounded border border-zinc-800 font-mono tracking-tight"
            >
              {tag.label}: {tag.value}
            </span>
          ))}
        </div>
      );
    } catch (err) {
      return (
        <span className="inline-block mt-2 text-[9px] text-zinc-500 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded font-medium">
          No EXIF Metadata
        </span>
      );
    }
  };

  // Calculate statistics
  const totalFiles = files.length;
  const processedFiles = files.filter(
    (f) => f.status === "success" || f.status === "error"
  ).length;
  const successCount = files.filter((f) => f.status === "success").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const globalProgress =
    totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;

  return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-50 font-sans"
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
    >
      {/* 3-Pane Layout Container */}
      <div className="flex w-full h-full">
        
        {/* Pane 1: Left Sidebar (Tool Selection & Config) */}
        <div className="flex flex-col w-80 h-full border-r border-zinc-900 bg-zinc-950 flex-shrink-0">
          {/* Logo & Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-900">
            <span className="text-lg font-medium tracking-wider text-zinc-100 flex items-center gap-2">
              IMAGO
            </span>
            <div className="flex items-center gap-2">
              {updateAvailable && (
                <span className="text-[10px] text-emerald-400 bg-emerald-950/20 px-2 py-0.5 rounded font-medium border border-emerald-900/30 animate-pulse">
                  Update Available
                </span>
              )}
              <span className="text-[10px] text-zinc-600 bg-zinc-900 px-2 py-0.5 rounded font-mono">
                v0.1.0
              </span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex flex-col gap-1 p-4 border-b border-zinc-900">
            <button
              onClick={() => setActiveTab("convert")}
              disabled={isProcessing}
              className={`flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-all text-left ${
                activeTab === "convert"
                  ? "bg-zinc-900 text-zinc-100 font-medium"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50"
              } disabled:opacity-50`}
            >
              <ImageIcon size={16} />
              <span>Convert Format</span>
            </button>
            <button
              onClick={() => setActiveTab("resize")}
              disabled={isProcessing}
              className={`flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-all text-left ${
                activeTab === "resize"
                  ? "bg-zinc-900 text-zinc-100 font-medium"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50"
              } disabled:opacity-50`}
            >
              <ResizeIcon size={16} />
              <span>Resize Image</span>
            </button>
            <button
              onClick={() => setActiveTab("crop-rotate")}
              disabled={isProcessing}
              className={`flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-all text-left ${
                activeTab === "crop-rotate"
                  ? "bg-zinc-900 text-zinc-100 font-medium"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50"
              } disabled:opacity-50`}
            >
              <CropIcon size={16} />
              <span>Crop & Rotate</span>
            </button>
            <button
              onClick={() => setActiveTab("metadata")}
              disabled={isProcessing}
              className={`flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-all text-left ${
                activeTab === "metadata"
                  ? "bg-zinc-900 text-zinc-100 font-medium"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50"
              } disabled:opacity-50`}
            >
              <ExifIcon size={16} />
              <span>EXIF Metadata</span>
            </button>
            <button
              onClick={() => setActiveTab("watermark")}
              disabled={isProcessing}
              className={`flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-all text-left ${
                activeTab === "watermark"
                  ? "bg-zinc-900 text-zinc-100 font-medium"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50"
              } disabled:opacity-50`}
            >
              <WatermarkIcon size={16} />
              <span>Watermarking</span>
            </button>
          </div>

          {/* Config Controls Container */}
          <div className="flex-1 overflow-y-auto p-6 scrollbar">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">
              Settings
            </h3>
            
            <div className="text-zinc-400 text-xs">
              {activeTab === "convert" && (
                <div className="space-y-5">
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-zinc-500 uppercase tracking-wider">Format</label>
                    <select
                      value={convertSettings.format}
                      onChange={(e) => setConvertSettings({ format: e.target.value as any })}
                      disabled={isProcessing}
                      className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700 w-full animate-duration-150"
                    >
                      <option value="jpeg">JPEG</option>
                      <option value="png">PNG</option>
                      <option value="webp">WebP (Lossless)</option>
                      <option value="avif">AVIF</option>
                    </select>
                  </div>
                  
                  {convertSettings.format === "jpeg" && (
                    <div className="flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs text-zinc-500 uppercase tracking-wider">Quality</label>
                        <span className="text-xs font-mono text-zinc-400">{convertSettings.quality}%</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={convertSettings.quality}
                        onChange={(e) => setConvertSettings({ quality: parseInt(e.target.value) })}
                        disabled={isProcessing}
                        className="w-full accent-zinc-200 h-1 bg-zinc-900 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  )}
                </div>
              )}
              
              {activeTab === "resize" && (
                <div className="space-y-5">
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-zinc-500 uppercase tracking-wider">Resize Method</label>
                    <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2.5 text-sm text-zinc-300 cursor-pointer">
                        <input
                          type="radio"
                          name="resizeMethod"
                          checked={resizeSettings.method === "max_bounds"}
                          onChange={() => setResizeSettings({ method: "max_bounds" })}
                          disabled={isProcessing}
                          className="accent-zinc-200"
                        />
                        <span>Scale to Fit (Max Bounds)</span>
                      </label>
                      <label className="flex items-center gap-2.5 text-sm text-zinc-300 cursor-pointer">
                        <input
                          type="radio"
                          name="resizeMethod"
                          checked={resizeSettings.method === "exact"}
                          onChange={() => setResizeSettings({ method: "exact" })}
                          disabled={isProcessing}
                          className="accent-zinc-200"
                        />
                        <span>Exact Dimensions (Stretch)</span>
                      </label>
                      <label className="flex items-center gap-2.5 text-sm text-zinc-300 cursor-pointer">
                        <input
                          type="radio"
                          name="resizeMethod"
                          checked={resizeSettings.method === "percentage"}
                          onChange={() => setResizeSettings({ method: "percentage" })}
                          disabled={isProcessing}
                          className="accent-zinc-200"
                        />
                        <span>Percentage (%)</span>
                      </label>
                    </div>
                  </div>

                  {resizeSettings.method !== "percentage" ? (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-zinc-500 uppercase tracking-wider">Width (px)</label>
                        <input
                          type="number"
                          min="1"
                          value={resizeSettings.width}
                          onChange={(e) => setResizeSettings({ width: parseInt(e.target.value) || 0 })}
                          disabled={isProcessing}
                          className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700 w-full font-mono"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-zinc-500 uppercase tracking-wider">Height (px)</label>
                        <input
                          type="number"
                          min="1"
                          value={resizeSettings.height}
                          onChange={(e) => setResizeSettings({ height: parseInt(e.target.value) || 0 })}
                          disabled={isProcessing}
                          className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700 w-full font-mono"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs text-zinc-500 uppercase tracking-wider">Scale</label>
                        <span className="text-xs font-mono text-zinc-400">{resizeSettings.percentage}%</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="200"
                        value={resizeSettings.percentage}
                        onChange={(e) => setResizeSettings({ percentage: parseInt(e.target.value) })}
                        disabled={isProcessing}
                        className="w-full accent-zinc-200 h-1 bg-zinc-900 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  )}
                </div>
              )}
              
              {activeTab === "crop-rotate" && (
                <div className="space-y-5">
                  {/* Interactive Crop Preview */}
                  <div className="flex flex-col gap-2">
                    <span className="text-xs text-zinc-500 uppercase tracking-wider">Live Preview</span>
                    <div className="relative overflow-hidden aspect-video bg-zinc-900 border border-zinc-800 rounded flex items-center justify-center select-none">
                      {files.length > 0 ? (
                        <div className="relative overflow-hidden w-full h-full flex items-center justify-center bg-zinc-950">
                          <img
                            ref={cropImgRef}
                            src={convertFileSrc(files[0].path)}
                            alt="Crop Preview"
                            onLoad={handleCropImageLoad}
                            className="max-w-full max-h-full object-contain pointer-events-none"
                          />
                          {cropRotateSettings.cropEnabled && (
                            <div style={getCropBoxStyle()} className="pointer-events-none z-10" />
                          )}
                        </div>
                      ) : (
                        <div className="text-[10px] text-zinc-500 p-4 text-center leading-relaxed">
                          Add images to the queue to see a crop preview
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 border-t border-zinc-900 pt-4">
                    <label className="text-xs text-zinc-500 uppercase tracking-wider">Rotation</label>
                    <select
                      value={cropRotateSettings.rotation}
                      onChange={(e) => setCropRotateSettings({ rotation: e.target.value as any })}
                      disabled={isProcessing}
                      className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700 w-full"
                    >
                      <option value="0">None (0°)</option>
                      <option value="90">90° Clockwise</option>
                      <option value="180">180° Rotate</option>
                      <option value="270">270° Counter-Clockwise</option>
                      <option value="auto">Auto-orient via EXIF</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-2 pt-2">
                    <label className="flex items-center gap-2.5 text-sm text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cropRotateSettings.cropEnabled}
                        onChange={(e) => setCropRotateSettings({ cropEnabled: e.target.checked })}
                        disabled={isProcessing}
                        className="accent-zinc-200 rounded"
                      />
                      <span>Enable Cropping</span>
                    </label>
                  </div>

                  {cropRotateSettings.cropEnabled && (
                    <div className="space-y-4 border-t border-zinc-900 pt-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">X Offset</label>
                          <input
                            type="number"
                            min="0"
                            value={cropRotateSettings.x}
                            onChange={(e) => setCropRotateSettings({ x: parseInt(e.target.value) || 0 })}
                            disabled={isProcessing}
                            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-700 w-full font-mono"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Y Offset</label>
                          <input
                            type="number"
                            min="0"
                            value={cropRotateSettings.y}
                            onChange={(e) => setCropRotateSettings({ y: parseInt(e.target.value) || 0 })}
                            disabled={isProcessing}
                            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-700 w-full font-mono"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Width</label>
                          <input
                            type="number"
                            min="1"
                            value={cropRotateSettings.width}
                            onChange={(e) => setCropRotateSettings({ width: parseInt(e.target.value) || 0 })}
                            disabled={isProcessing}
                            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-700 w-full font-mono"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Height</label>
                          <input
                            type="number"
                            min="1"
                            value={cropRotateSettings.height}
                            onChange={(e) => setCropRotateSettings({ height: parseInt(e.target.value) || 0 })}
                            disabled={isProcessing}
                            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-700 w-full font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {activeTab === "metadata" && (
                <div className="space-y-5">
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-zinc-500 uppercase tracking-wider">Action</label>
                    <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2.5 text-sm text-zinc-300 cursor-pointer">
                        <input
                          type="radio"
                          name="metadataAction"
                          checked={metadataSettings.action === "read"}
                          onChange={() => setMetadataSettings({ action: "read" })}
                          disabled={isProcessing}
                          className="accent-zinc-200"
                        />
                        <span>Read & View Tags</span>
                      </label>
                      <label className="flex items-center gap-2.5 text-sm text-zinc-300 cursor-pointer">
                        <input
                          type="radio"
                          name="metadataAction"
                          checked={metadataSettings.action === "strip"}
                          onChange={() => setMetadataSettings({ action: "strip" })}
                          disabled={isProcessing}
                          className="accent-zinc-200"
                        />
                        <span>Strip/Delete EXIF Data</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
              
              {activeTab === "watermark" && (
                <div className="space-y-5">
                  {/* Interactive Watermark Preview */}
                  <div className="flex flex-col gap-2">
                    <span className="text-xs text-zinc-500 uppercase tracking-wider">Live Preview</span>
                    <div className="relative overflow-hidden aspect-video bg-zinc-900 border border-zinc-800 rounded flex items-center justify-center select-none">
                      <img
                        src={previewImg}
                        alt="Preview Scenery"
                        className="w-full h-full object-cover pointer-events-none"
                      />
                      
                      {/* Text Overlay */}
                      {watermarkSettings.watermarkType === "text" && (
                        <div
                          className={`absolute p-2 pointer-events-none ${
                            watermarkSettings.textConfig.position === "top-left" ? "top-2 left-2" :
                            watermarkSettings.textConfig.position === "top-right" ? "top-2 right-2 text-right" :
                            watermarkSettings.textConfig.position === "bottom-left" ? "bottom-2 left-2" :
                            watermarkSettings.textConfig.position === "bottom-right" ? "bottom-2 right-2 text-right" :
                            "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center"
                          }`}
                          style={{
                            color: watermarkSettings.textConfig.color,
                            opacity: watermarkSettings.textConfig.opacity,
                            fontSize: `${Math.max(8, Math.min(24, watermarkSettings.textConfig.fontSize / 2))}px`,
                            fontWeight: "bold",
                            textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
                          }}
                        >
                          {watermarkSettings.textConfig.text || "Watermark"}
                        </div>
                      )}

                      {/* Image Overlay */}
                      {watermarkSettings.watermarkType === "image" && watermarkSettings.imageConfig.path && (
                        <div
                          className={`absolute p-2 pointer-events-none flex ${
                            watermarkSettings.imageConfig.position === "top-left" ? "top-2 left-2 items-start justify-start" :
                            watermarkSettings.imageConfig.position === "top-right" ? "top-2 right-2 items-start justify-end" :
                            watermarkSettings.imageConfig.position === "bottom-left" ? "bottom-2 left-2 items-end justify-start" :
                            watermarkSettings.imageConfig.position === "bottom-right" ? "bottom-2 right-2 items-end justify-end" :
                            "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                          }`}
                          style={{
                            opacity: watermarkSettings.imageConfig.opacity,
                            width: `${watermarkSettings.imageConfig.scale * 100}%`,
                          }}
                        >
                          <img
                            src={convertFileSrc(watermarkSettings.imageConfig.path)}
                            alt="Watermark Overlay"
                            className="max-w-full max-h-12 object-contain"
                          />
                        </div>
                      )}
                      
                      {watermarkSettings.watermarkType === "image" && !watermarkSettings.imageConfig.path && (
                        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/40 text-[10px] text-zinc-500">
                          Select watermark image to preview
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 border-t border-zinc-900 pt-4">
                    <label className="text-xs text-zinc-500 uppercase tracking-wider">Watermark Type</label>
                    <div className="grid grid-cols-2 gap-2 bg-zinc-900 p-1 rounded border border-zinc-900">
                      <button
                        onClick={() => setWatermarkSettings({ watermarkType: "text" })}
                        disabled={isProcessing}
                        className={`px-3 py-1.5 text-[11px] rounded transition-all ${
                          watermarkSettings.watermarkType === "text"
                            ? "bg-zinc-800 text-zinc-100 font-medium"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        Text Overlay
                      </button>
                      <button
                        onClick={() => setWatermarkSettings({ watermarkType: "image" })}
                        disabled={isProcessing}
                        className={`px-3 py-1.5 text-[11px] rounded transition-all ${
                          watermarkSettings.watermarkType === "image"
                            ? "bg-zinc-800 text-zinc-100 font-medium"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        Image Overlay
                      </button>
                    </div>
                  </div>

                  {watermarkSettings.watermarkType === "text" ? (
                    <div className="space-y-4">
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-zinc-500 uppercase tracking-wider">Text</label>
                        <input
                          type="text"
                          value={watermarkSettings.textConfig.text}
                          onChange={(e) =>
                            setWatermarkSettings({
                              textConfig: { ...watermarkSettings.textConfig, text: e.target.value },
                            })
                          }
                          disabled={isProcessing}
                          className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700 w-full"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Font Size (px)</label>
                          <input
                            type="number"
                            min="8"
                            max="120"
                            value={watermarkSettings.textConfig.fontSize}
                            onChange={(e) =>
                              setWatermarkSettings({
                                textConfig: {
                                  ...watermarkSettings.textConfig,
                                  fontSize: parseInt(e.target.value) || 24,
                                },
                              })
                            }
                            disabled={isProcessing}
                            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-700 w-full font-mono"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Color (Hex)</label>
                          <input
                            type="text"
                            value={watermarkSettings.textConfig.color}
                            onChange={(e) =>
                              setWatermarkSettings({
                                textConfig: { ...watermarkSettings.textConfig, color: e.target.value },
                              })
                            }
                            disabled={isProcessing}
                            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-700 w-full font-mono"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                          <label className="text-xs text-zinc-500 uppercase tracking-wider">Opacity</label>
                          <span className="text-xs font-mono text-zinc-400">
                            {Math.round(watermarkSettings.textConfig.opacity * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={watermarkSettings.textConfig.opacity}
                          onChange={(e) =>
                            setWatermarkSettings({
                              textConfig: {
                                ...watermarkSettings.textConfig,
                                opacity: parseFloat(e.target.value),
                              },
                            })
                          }
                          disabled={isProcessing}
                          className="w-full accent-zinc-200 h-1 bg-zinc-900 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-zinc-500 uppercase tracking-wider">Position</label>
                        <select
                          value={watermarkSettings.textConfig.position}
                          onChange={(e) =>
                            setWatermarkSettings({
                              textConfig: {
                                ...watermarkSettings.textConfig,
                                position: e.target.value as any,
                              },
                            })
                          }
                          disabled={isProcessing}
                          className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700 w-full"
                        >
                          <option value="top-left">Top Left</option>
                          <option value="top-right">Top Right</option>
                          <option value="bottom-left">Bottom Left</option>
                          <option value="bottom-right">Bottom Right</option>
                          <option value="center">Center</option>
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-zinc-500 uppercase tracking-wider">Overlay Image</label>
                        <div className="flex flex-col gap-2 bg-zinc-900/30 border border-zinc-900 rounded p-3">
                          <span className="text-[10px] text-zinc-500 break-all font-mono">
                            {watermarkSettings.imageConfig.path || "No image selected"}
                          </span>
                          <button
                            onClick={async () => {
                              try {
                                const selected = await invoke<string[] | null>("select_files");
                                if (selected && selected[0]) {
                                  setWatermarkSettings({
                                    imageConfig: {
                                      ...watermarkSettings.imageConfig,
                                      path: selected[0],
                                    },
                                  });
                                }
                              } catch (err) {
                                console.error("Failed to select watermark file:", err);
                              }
                            }}
                            disabled={isProcessing}
                            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-[11px] border border-zinc-800 hover:border-zinc-700 bg-zinc-950 text-zinc-300 rounded transition-all disabled:opacity-50"
                          >
                            <FolderOpen size={10} />
                            <span>Select Image</span>
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                          <label className="text-xs text-zinc-500 uppercase tracking-wider">Scale</label>
                          <span className="text-xs font-mono text-zinc-400">
                            {Math.round(watermarkSettings.imageConfig.scale * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.05"
                          max="0.95"
                          step="0.05"
                          value={watermarkSettings.imageConfig.scale}
                          onChange={(e) =>
                            setWatermarkSettings({
                              imageConfig: {
                                ...watermarkSettings.imageConfig,
                                scale: parseFloat(e.target.value),
                              },
                            })
                          }
                          disabled={isProcessing}
                          className="w-full accent-zinc-200 h-1 bg-zinc-900 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                          <label className="text-xs text-zinc-500 uppercase tracking-wider">Opacity</label>
                          <span className="text-xs font-mono text-zinc-400">
                            {Math.round(watermarkSettings.imageConfig.opacity * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={watermarkSettings.imageConfig.opacity}
                          onChange={(e) =>
                            setWatermarkSettings({
                              imageConfig: {
                                ...watermarkSettings.imageConfig,
                                opacity: parseFloat(e.target.value),
                              },
                            })
                          }
                          disabled={isProcessing}
                          className="w-full accent-zinc-200 h-1 bg-zinc-900 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-zinc-500 uppercase tracking-wider">Position</label>
                        <select
                          value={watermarkSettings.imageConfig.position}
                          onChange={(e) =>
                            setWatermarkSettings({
                              imageConfig: {
                                ...watermarkSettings.imageConfig,
                                position: e.target.value as any,
                              },
                            })
                          }
                          disabled={isProcessing}
                          className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700 w-full"
                        >
                          <option value="top-left">Top Left</option>
                          <option value="top-right">Top Right</option>
                          <option value="bottom-left">Bottom Left</option>
                          <option value="bottom-right">Bottom Right</option>
                          <option value="center">Center</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Pane 2: Center (Spacious Queue & Drag Drop Zone) */}
        <div className="flex flex-col flex-1 min-w-[360px] h-full bg-zinc-950 relative">
          {/* Header */}
          <div className="flex items-center justify-between px-8 py-5 border-b border-zinc-900 flex-shrink-0">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-medium text-zinc-100">Queue</h2>
              {files.length > 0 && (
                <span className="text-xs bg-zinc-900 text-zinc-400 px-2 py-0.5 rounded-full">
                  {files.length} items
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-4">
              {files.length > 0 && (
                <button
                  onClick={handleSelectFiles}
                  disabled={isProcessing}
                  className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1 disabled:opacity-50"
                >
                  <Plus size={12} />
                  <span>Add Files</span>
                </button>
              )}
              {files.length > 0 && (
                <button
                  onClick={clearQueue}
                  disabled={isProcessing}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Trash2 size={12} />
                  <span>Clear Queue</span>
                </button>
              )}
            </div>
          </div>

          {/* Queue Viewport */}
          <div className="flex-1 overflow-y-auto p-8 scrollbar relative">
            {files.length === 0 ? (
              // Empty State - Drag and Drop Zone
              <div
                onClick={handleSelectFiles}
                className={`flex flex-col items-center justify-center h-full w-full border border-dashed rounded-lg transition-all cursor-pointer ${
                  dragActive
                    ? "border-zinc-500 bg-zinc-900/10"
                    : "border-zinc-800 hover:border-zinc-700 bg-zinc-950"
                }`}
              >
                <input
                  type="file"
                  multiple
                  ref={fileInputRef}
                  onChange={(e) => {
                    if (e.target.files) {
                      const paths = Array.from(e.target.files).map(
                        (f: any) => f.path || f.name
                      );
                      addFiles(paths);
                    }
                  }}
                  className="hidden"
                />
                <Plus size={32} className="text-zinc-600 mb-4 stroke-[1.5]" />
                <span className="text-sm text-zinc-300 font-medium mb-1">
                  Drag & drop images here
                </span>
                <span className="text-xs text-zinc-600">
                  or click to select from files
                </span>
              </div>
            ) : (
              // Populated Queue Grid
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {files.map((file) => (
                  <div
                    key={file.path}
                    className="flex flex-col bg-zinc-900/30 border border-zinc-900 rounded-lg p-4 relative group hover:border-zinc-800 transition-all"
                  >
                    {/* Remove button */}
                    {!isProcessing && (
                      <button
                        onClick={() => removeFile(file.path)}
                        className="absolute top-2 right-2 p-1 rounded-md text-zinc-600 hover:text-zinc-400 hover:bg-zinc-900 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <X size={12} />
                      </button>
                    )}

                    <div className="flex gap-4">
                      {/* Image Thumbnail */}
                      <div className="w-16 h-16 bg-zinc-950 rounded border border-zinc-900 overflow-hidden flex-shrink-0 flex items-center justify-center">
                        <img
                          src={convertFileSrc(file.path)}
                          alt={file.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as any).src = "";
                          }}
                        />
                      </div>

                      {/* File Details */}
                      <div className="flex flex-col min-w-0 justify-center flex-1">
                        <span className="text-xs font-medium text-zinc-300 truncate">
                          {file.name}
                        </span>
                        <span className="text-[10px] text-zinc-600 truncate mt-0.5">
                          {file.path}
                        </span>
                        
                        {/* Message status line */}
                        {file.message && !file.message.startsWith("EXIF_READ:") && (
                          <span className="text-[10px] text-zinc-500 truncate mt-1">
                            {file.message}
                          </span>
                        )}

                        {/* EXIF capsules display */}
                        {file.message && file.message.startsWith("EXIF_READ:") && renderExifCapsules(file.message)}
                      </div>
                    </div>

                    {/* Individual Status Badge / Progress Bar */}
                    <div className="mt-4 flex items-center justify-between text-[10px] border-t border-zinc-900/60 pt-3">
                      <span className="text-zinc-500">Status</span>
                      <div className="flex items-center gap-1.5">
                        {file.status === "pending" && (
                          <span className="text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded font-mono">
                            Pending
                          </span>
                        )}
                        {file.status === "processing" && (
                          <span className="text-blue-400 bg-blue-950/20 px-2 py-0.5 rounded font-mono flex items-center gap-1">
                            <Loader2 size={10} className="animate-spin" />
                            Processing
                          </span>
                        )}
                        {file.status === "success" && (
                          <span className="text-emerald-400 bg-emerald-950/20 px-2 py-0.5 rounded font-mono flex items-center gap-1">
                            <CheckCircle2 size={10} />
                            Done
                          </span>
                        )}
                        {file.status === "error" && (
                          <span className="text-red-400 bg-red-950/20 px-2 py-0.5 rounded font-mono flex items-center gap-1">
                            <AlertCircle size={10} />
                            Failed
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar under processing */}
                    {file.status === "processing" && (
                      <div className="w-full bg-zinc-900 h-1 mt-3 rounded-full overflow-hidden">
                        <div className="bg-blue-500 h-full animate-pulse w-1/2"></div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Add More Card */}
                {!isProcessing && (
                  <button
                    onClick={handleSelectFiles}
                    className="flex flex-col items-center justify-center border border-dashed border-zinc-800 hover:border-zinc-700 bg-zinc-900/10 rounded-lg p-6 min-h-[140px] cursor-pointer transition-all hover:bg-zinc-900/20"
                  >
                    <Plus size={20} className="text-zinc-500 mb-2" />
                    <span className="text-[11px] text-zinc-400 font-medium">Add more files</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Floating Drop Zone Overlay */}
          {dragActive && files.length > 0 && (
            <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm border-2 border-dashed border-zinc-700 m-4 rounded-lg flex flex-col items-center justify-center pointer-events-none z-10">
              <Plus size={32} className="text-zinc-400 mb-2 animate-bounce" />
              <span className="text-sm font-medium text-zinc-300">
                Drop to add files to queue
              </span>
            </div>
          )}
        </div>

        {/* Pane 3: Right Sidebar (Output Config & Processing Action) */}
        <div className="flex flex-col w-80 h-full border-l border-zinc-900 bg-zinc-950 flex-shrink-0">
          <div className="px-6 py-5 border-b border-zinc-900">
            <h2 className="text-base font-medium text-zinc-100">Execution</h2>
          </div>

          <div className="flex-1 p-6 space-y-6 overflow-y-auto scrollbar">
            {/* Output Directory configuration */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                Output Folder
              </span>
              <div className="flex flex-col gap-2 bg-zinc-900/30 border border-zinc-900 rounded p-3">
                <span className="text-[11px] text-zinc-400 break-all font-mono">
                  {outputDir || "Resolving directory..."}
                </span>
                <button
                  onClick={handleSelectOutput}
                  disabled={isProcessing}
                  className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs border border-zinc-800 hover:border-zinc-700 bg-zinc-950 text-zinc-300 rounded transition-all disabled:opacity-50"
                >
                  <FolderOpen size={12} />
                  <span>Change Directory</span>
                </button>
              </div>
            </div>

            {/* Execution statistics */}
            <div className="space-y-3">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                Summary Stats
              </span>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-900/20 border border-zinc-900 p-3 rounded">
                  <span className="text-[10px] text-zinc-500 block uppercase">
                    Total Files
                  </span>
                  <span className="text-lg font-medium font-mono tracking-tight text-zinc-200">
                    {totalFiles}
                  </span>
                </div>
                <div className="bg-zinc-900/20 border border-zinc-900 p-3 rounded">
                  <span className="text-[10px] text-zinc-500 block uppercase">
                    Processed
                  </span>
                  <span className="text-lg font-medium font-mono tracking-tight text-zinc-200">
                    {processedFiles}
                  </span>
                </div>
                <div className="bg-zinc-900/20 border border-zinc-900 p-3 rounded">
                  <span className="text-[10px] text-zinc-500 block uppercase">
                    Success
                  </span>
                  <span className="text-lg font-medium font-mono tracking-tight text-emerald-400">
                    {successCount}
                  </span>
                </div>
                <div className="bg-zinc-900/20 border border-zinc-900 p-3 rounded">
                  <span className="text-[10px] text-zinc-500 block uppercase">
                    Errors
                  </span>
                  <span className="text-lg font-medium font-mono tracking-tight text-red-400">
                    {errorCount}
                  </span>
                </div>
              </div>
            </div>

            {/* Global progress tracker */}
            {isProcessing && (
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-zinc-500">Overall Progress</span>
                  <span className="font-mono text-zinc-300">{globalProgress}%</span>
                </div>
                <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-zinc-100 h-full transition-all duration-300"
                    style={{ width: `${globalProgress}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>

          {/* Action Trigger button */}
          <div className="p-6 border-t border-zinc-900 space-y-4">
            {validationError && (
              <div className="flex gap-2.5 p-3 rounded bg-red-950/20 border border-red-900/30 text-red-400 text-xs animate-in fade-in duration-200">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{validationError}</span>
              </div>
            )}

            <button
              onClick={handleProcessBatch}
              disabled={files.length === 0 || isProcessing || !!validationError}
              className={`w-full flex items-center justify-center gap-3 px-4 py-3 rounded text-sm font-medium tracking-wide transition-all ${
                files.length === 0 || isProcessing || !!validationError
                  ? "bg-zinc-900 text-zinc-600 border border-zinc-900 cursor-not-allowed"
                  : "bg-zinc-50 hover:bg-zinc-200 text-zinc-950 font-semibold cursor-pointer shadow-lg hover:shadow-xl"
              }`}
            >
              {isProcessing ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Processing Batch...</span>
                </>
              ) : (
                <>
                  <Play size={14} className="fill-current" />
                  <span>Start Processing</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;
