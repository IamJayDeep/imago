# Project Development Plan: Imago Image Processor

This document outlines the step-by-step plan for building **Imago**, a high-performance, lightweight, and offline-first desktop Image Processing application built with Tauri v2, Rust, and React.

---

## 🛠️ Tech Stack & Design Architecture

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Lucide React (bundled locally).
- **Backend**: Rust (Tauri v2).
- **Key Rust Crates**:
  - `image` (processing, with `webp` and `avif` features enabled).
  - `kamadak-exif` (metadata management).
  - `rayon` (parallel batch processing).
  - `imageproc` (drawing/text watermarking).
  - `tokio` (async runtime for events).
  - `dirs` (resolving picture directories cross-platform).
- **Tauri Plugins**:
  - `@tauri-apps/plugin-dialog`
  - `@tauri-apps/plugin-fs`
  - `@tauri-apps/plugin-updater`
  - `@tauri-apps/plugin-os`

---

## 📋 Implementation Steps

### ⚙️ Step 1: Project Setup & Cross-Platform Dependencies
- **Rust Backend**:
  - Add all required dependencies and features to `Cargo.toml`.
  - Configure the image processing features (`webp`, `avif`).
- **Frontend**:
  - Update `package.json` with required npm packages.
  - Install dependencies (Zustand, Lucide React, etc.).
- **Tauri Configuration**:
  - Update `tauri.conf.json` with plugins, capabilities/permissions, and updater configuration placeholders.
  - Configure capability files in `src-tauri/capabilities/default.json` to allow filesystem, dialog, operating system, and updater access.
- **Environment Prep**:
  - Document the exact commands for installing Tauri Linux build dependencies.

---

### 🦀 Step 2: Rust Backend - Core Processing & Directory Logic
- **Directory Helper**:
  - Create standard directory utility that finds `dirs::picture_dir()`, resolves the `Imago` directory cross-platform, and creates it if missing.
- **Data Models**:
  - Design the configurations for each tool (Convert, Resize, Crop/Rotate, EXIF, Watermark).
  - Create the `ProcessJob` representation structure.
- **Rayon Batch Pipeline**:
  - Build concurrent batch processing with `rayon`.
  - Integrate progress events that emit progress updates asynchronously (e.g. `Processing 5/100: image.jpg`) to React.
  - Design error boundary handling per file so the batch doesn't halt on single file errors.

---

### 🎨 Step 3: React Frontend - State & UI Shell
- **Tailwind Setup**:
  - Ensure Tailwind is fully functional and uses local assets (no external CDNs).
- **State Management**:
  - Implement Zustand store to manage active tool, selection queue, processing status, progress, and output path.
- **Drag-and-Drop / File Grid**:
  - Implement the drag-and-drop zone.
  - Build the main 3-pane layout:
    - **Left**: Tool Selector Sidebar.
    - **Center**: File List Grid (showing thumbnails and status tags).
    - **Right/Bottom**: Output folder selector, Progress bar, and Process trigger.

---

### 🧩 Step 4: React Frontend - Tool Panels & Integration
- **Sidebar Panels**:
  - **Convert**: Format type selector, quality/compression slider.
  - **Crop & Rotate**: Custom dimensions input, standard rotation selection, or auto-exif orient.
  - **Resize**: Exact dimensions, percentage scaling, or max bounds aspect scaling.
  - **EXIF**: Read view, custom metadata tag fields, or strip EXIF options.
  - **Watermark**: Option tabs for text (font, size, color, opacity, position) or image overlay.
- **IPC Integration**:
  - Connect UI actions to Tauri command invokes.
  - Set up Tauri event listeners to capture progress streaming.

---

### 🚀 Step 5: Updater, Offline Polish & Font Bundling
- **Updater Plugin**:
  - Initialize the update checker at app launch with non-blocking error handling (silent failures if offline).
- **Local Asset Bundling**:
  - Set up local `.ttf` font file inside `src-tauri/` resources.
  - Load and render text watermarks using the bundled font.
- **Production Checklist**:
  - Build verification, performance audits, and error recovery testing.
