use std::path::{Path, PathBuf};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use image::{DynamicImage, ImageFormat, ImageEncoder};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::webp::WebPEncoder;
use image::imageops::FilterType;
use imageproc::drawing::draw_text_mut;
use ab_glyph::{FontRef, PxScale};
use rayon::prelude::*;
use tauri::Emitter;
use tauri::Manager;
use tauri::path::BaseDirectory;


#[derive(Deserialize, Debug, Clone)]
pub struct CropConfig {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Deserialize, Debug, Clone)]
pub struct TextWatermarkConfig {
    pub text: String,
    pub font_size: f32,
    pub color: String, // hex color, e.g. "#ffffff"
    pub opacity: f32,   // 0.0 to 1.0
    pub position: String, // "top-left", "top-right", "bottom-left", "bottom-right", "center"
}

#[derive(Deserialize, Debug, Clone)]
pub struct ImageWatermarkConfig {
    pub path: String,
    pub opacity: f32,   // 0.0 to 1.0
    pub position: String, // "top-left", "top-right", "bottom-left", "bottom-right", "center"
    pub scale: f32,     // 0.0 to 1.0 (relative to main image width)
}

#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "type", content = "config")]
pub enum ToolSettings {
    Convert {
        format: String,  // e.g. "png" | "jpeg" | "webp" | "avif" | "bmp" | "gif" | "tiff" | "ico"
        quality: u8,     // 0-100
        background_fill: String, // "white" | "black"
    },
    CropRotate {
        rotation: String, // "0" | "90" | "180" | "270" | "auto"
        crop: Option<CropConfig>,
    },
    Resize {
        method: String, // "exact" | "percentage" | "max_bounds"
        width: Option<u32>,
        height: Option<u32>,
        percentage: Option<f32>,
    },
    Metadata {
        action: String, // "read" | "update" | "strip"
        updates: Option<HashMap<String, String>>,
    },
    Watermark {
        watermark_type: String, // "text" | "image"
        text_config: Option<TextWatermarkConfig>,
        image_config: Option<ImageWatermarkConfig>,
    },
}

#[derive(Serialize, Clone)]
pub struct ProgressPayload {
    pub file_path: String,
    pub index: usize,
    pub total: usize,
    pub status: String,   // "processing" | "success" | "error"
    pub message: String,
}

/// Helper to read EXIF tags from a file.
pub fn read_exif_tags(path: &Path) -> Result<HashMap<String, String>, String> {
    let file = File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut reader = BufReader::new(file);
    let exif_reader = exif::Reader::new();
    
    let mut tags = HashMap::new();
    match exif_reader.read_from_container(&mut reader) {
        Ok(exif) => {
            for field in exif.fields() {
                let tag_name = field.tag.to_string();
                let tag_value = field.display_value().to_string();
                tags.insert(tag_name, tag_value);
            }
        }
        Err(e) => {
            tags.insert("error".to_string(), format!("No metadata or failed to parse: {}", e));
        }
    }
    Ok(tags)
}

/// Helper to save image with optional format and quality settings.
fn save_image(img: &DynamicImage, output_path: &Path, format: &str, quality: u8) -> Result<(), String> {
    let file = File::create(output_path).map_err(|e| format!("Failed to create output file: {}", e))?;
    let mut writer = BufWriter::new(file);
    
    match format.to_lowercase().as_str() {
        "jpg" | "jpeg" => {
            let encoder = JpegEncoder::new_with_quality(&mut writer, quality);
            img.write_with_encoder(encoder).map_err(|e| format!("Failed to write JPEG: {}", e))?;
        }
        "webp" => {
            // WebPEncoder in image v0.25 supports lossless encoding only.
            let rgba_image = img.to_rgba8();
            let encoder = WebPEncoder::new_lossless(&mut writer);
            encoder.encode(
                rgba_image.as_raw(),
                rgba_image.width(),
                rgba_image.height(),
                image::ColorType::Rgba8.into(),
            ).map_err(|e| format!("Failed to encode WebP: {}", e))?;
        }
        "png" => {
            img.write_to(&mut writer, ImageFormat::Png)
                .map_err(|e| format!("Failed to write PNG: {}", e))?;
        }
        "avif" => {
            img.write_to(&mut writer, ImageFormat::Avif)
                .map_err(|e| format!("Failed to write AVIF: {}", e))?;
        }
        "bmp" => {
            img.write_to(&mut writer, ImageFormat::Bmp)
                .map_err(|e| format!("Failed to write BMP: {}", e))?;
        }
        "gif" => {
            img.write_to(&mut writer, ImageFormat::Gif)
                .map_err(|e| format!("Failed to write GIF: {}", e))?;
        }
        "ico" => {
            img.write_to(&mut writer, ImageFormat::Ico)
                .map_err(|e| format!("Failed to write ICO: {}", e))?;
        }
        "tiff" => {
            img.write_to(&mut writer, ImageFormat::Tiff)
                .map_err(|e| format!("Failed to write TIFF: {}", e))?;
        }
        _ => {
            img.save(output_path).map_err(|e| format!("Failed to save: {}", e))?;
        }
    }
    Ok(())
}

/// Flattens the image alpha channel (transparency) onto a solid white or black background.
fn flatten_image_background(img: &DynamicImage, fill_color: &str) -> DynamicImage {
    if !img.color().has_alpha() {
        return img.clone();
    }
    
    let w = img.width();
    let h = img.height();
    
    let bg_pixel = match fill_color.to_lowercase().as_str() {
        "black" => image::Rgba([0, 0, 0, 255]),
        _ => image::Rgba([255, 255, 255, 255]), // default white
    };
    
    let mut bg_image = image::ImageBuffer::from_pixel(w, h, bg_pixel);
    let rgba_img = img.to_rgba8();
    
    image::imageops::overlay(&mut bg_image, &rgba_img, 0, 0);
    
    DynamicImage::ImageRgba8(bg_image)
}

/// Helper to parse Hex color into Rgba.
fn parse_hex_color(hex: &str, opacity: f32) -> image::Rgba<u8> {
    let hex = hex.trim_start_matches('#');
    let mut rgb = [255, 255, 255];
    if hex.len() >= 6 {
        if let Ok(r) = u8::from_str_radix(&hex[0..2], 16) {
            rgb[0] = r;
        }
        if let Ok(g) = u8::from_str_radix(&hex[2..4], 16) {
            rgb[1] = g;
        }
        if let Ok(b) = u8::from_str_radix(&hex[4..6], 16) {
            rgb[2] = b;
        }
    }
    let a = (opacity * 255.0).clamp(0.0, 255.0) as u8;
    image::Rgba([rgb[0], rgb[1], rgb[2], a])
}

fn apply_rotation(img: DynamicImage, rotation: &str, path: &Path) -> Result<DynamicImage, String> {
    match rotation {
        "90" => Ok(img.rotate90()),
        "180" => Ok(img.rotate180()),
        "270" => Ok(img.rotate270()),
        "auto" => {
            let file = File::open(path).map_err(|e| format!("Failed to open for orientation check: {}", e))?;
            let mut reader = BufReader::new(file);
            let exif_reader = exif::Reader::new();
            if let Ok(exif) = exif_reader.read_from_container(&mut reader) {
                if let Some(orient_field) = exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY) {
                    if let Some(orient_val) = orient_field.value.get_uint(0) {
                        return match orient_val {
                            1 => Ok(img),
                            2 => Ok(img.fliph()),
                            3 => Ok(img.rotate180()),
                            4 => Ok(img.flipv()),
                            5 => Ok(img.fliph().rotate270()),
                            6 => Ok(img.rotate90()),
                            7 => Ok(img.fliph().rotate90()),
                            8 => Ok(img.rotate270()),
                            _ => Ok(img),
                        };
                    }
                }
            }
            Ok(img)
        }
        _ => Ok(img),
    }
}

fn apply_crop(mut img: DynamicImage, crop: &CropConfig) -> Result<DynamicImage, String> {
    if crop.x + crop.width > img.width() || crop.y + crop.height > img.height() {
        return Err(format!(
            "Crop rectangle [x: {}, y: {}, w: {}, h: {}] exceeds image bounds [{}x{}]",
            crop.x, crop.y, crop.width, crop.height, img.width(), img.height()
        ));
    }
    Ok(img.crop(crop.x, crop.y, crop.width, crop.height))
}

fn apply_resize(img: DynamicImage, method: &str, width: Option<u32>, height: Option<u32>, percentage: Option<f32>) -> Result<DynamicImage, String> {
    match method {
        "exact" => {
            let w = width.ok_or_else(|| "Width is required for exact resize".to_string())?;
            let h = height.ok_or_else(|| "Height is required for exact resize".to_string())?;
            Ok(img.resize_exact(w, h, FilterType::Lanczos3))
        }
        "percentage" => {
            let pct = percentage.ok_or_else(|| "Percentage is required for resize".to_string())? / 100.0;
            let w = (img.width() as f32 * pct).round() as u32;
            let h = (img.height() as f32 * pct).round() as u32;
            Ok(img.resize_exact(w, h, FilterType::Lanczos3))
        }
        "max_bounds" => {
            let max_w = width.unwrap_or(u32::MAX);
            let max_h = height.unwrap_or(u32::MAX);
            Ok(img.resize(max_w, max_h, FilterType::Lanczos3))
        }
        _ => Err(format!("Unsupported resize method: {}", method)),
    }
}

fn apply_text_watermark(
    img: DynamicImage,
    config: &TextWatermarkConfig,
    font_bytes: &[u8],
) -> Result<DynamicImage, String> {
    let font = FontRef::try_from_slice(font_bytes)
        .map_err(|e| format!("Failed to parse font: {}", e))?;
    
    let mut rgba_img = img.to_rgba8();
    let scale = PxScale { x: config.font_size, y: config.font_size };
    
    let (text_w, text_h) = imageproc::drawing::text_size(scale, &font, &config.text);
    let text_w = text_w as i32;
    let text_h = text_h as i32;
    
    let img_w = rgba_img.width() as i32;
    let img_h = rgba_img.height() as i32;
    
    let padding = 20;
    let (x, y) = match config.position.as_str() {
        "top-left" => (padding, padding),
        "top-right" => (img_w - text_w - padding, padding),
        "bottom-left" => (padding, img_h - text_h - padding),
        "bottom-right" => (img_w - text_w - padding, img_h - text_h - padding),
        "center" => ((img_w - text_w) / 2, (img_h - text_h) / 2),
        _ => (padding, padding),
    };
    
    let color = parse_hex_color(&config.color, config.opacity);
    draw_text_mut(&mut rgba_img, color, x, y, scale, &font, &config.text);
    
    Ok(DynamicImage::ImageRgba8(rgba_img))
}

fn apply_image_watermark(
    img: DynamicImage,
    config: &ImageWatermarkConfig,
) -> Result<DynamicImage, String> {
    let mut main_rgba = img.to_rgba8();
    
    let overlay_img = image::open(&config.path)
        .map_err(|e| format!("Failed to open watermark overlay file: {}", e))?;
    let overlay_rgba = overlay_img.to_rgba8();
    
    let target_width = (main_rgba.width() as f32 * config.scale).round() as u32;
    let aspect_ratio = overlay_rgba.height() as f32 / overlay_rgba.width() as f32;
    let target_height = (target_width as f32 * aspect_ratio).round() as u32;
    
    let resized_overlay = image::imageops::resize(
        &overlay_rgba,
        target_width,
        target_height,
        FilterType::Lanczos3,
    );
    
    let main_w = main_rgba.width() as i32;
    let main_h = main_rgba.height() as i32;
    let over_w = resized_overlay.width() as i32;
    let over_h = resized_overlay.height() as i32;
    
    let padding = 20;
    let (start_x, start_y) = match config.position.as_str() {
        "top-left" => (padding, padding),
        "top-right" => (main_w - over_w - padding, padding),
        "bottom-left" => (padding, main_h - over_h - padding),
        "bottom-right" => (main_w - over_w - padding, main_h - over_h - padding),
        "center" => ((main_w - over_w) / 2, (main_h - over_h) / 2),
        _ => (padding, padding),
    };
    
    for y_offset in 0..resized_overlay.height() {
        for x_offset in 0..resized_overlay.width() {
            let dest_x = start_x + x_offset as i32;
            let dest_y = start_y + y_offset as i32;
            
            if dest_x >= 0 && dest_x < main_w && dest_y >= 0 && dest_y < main_h {
                let overlay_pixel = resized_overlay.get_pixel(x_offset, y_offset);
                let main_pixel = main_rgba.get_pixel_mut(dest_x as u32, dest_y as u32);
                
                let overlay_alpha = (overlay_pixel[3] as f32 / 255.0) * config.opacity;
                if overlay_alpha > 0.0 {
                    for c in 0..3 {
                        let main_c = main_pixel[c] as f32;
                        let over_c = overlay_pixel[c] as f32;
                        main_pixel[c] = ((1.0 - overlay_alpha) * main_c + overlay_alpha * over_c).clamp(0.0, 255.0) as u8;
                    }
                    let main_alpha = main_pixel[3] as f32 / 255.0;
                    let new_alpha = overlay_alpha + main_alpha * (1.0 - overlay_alpha);
                    main_pixel[3] = (new_alpha * 255.0).clamp(0.0, 255.0) as u8;
                }
            }
        }
    }
    
    Ok(DynamicImage::ImageRgba8(main_rgba))
}

/// Resolves a unique output path in the target directory by appending "_1", "_2", etc.
/// if a file with the same name already exists.
fn get_unique_output_path(
    base_dir: &Path,
    base_name: &str,
    suffix: &str,
    extension: &str,
    reserved_paths: &Mutex<HashSet<PathBuf>>,
) -> PathBuf {
    let mut filename = format!("{}{}.{}", base_name, suffix, extension);
    let mut path = base_dir.join(&filename);
    
    let mut lock = reserved_paths.lock().unwrap();
    if !path.exists() && !lock.contains(&path) {
        lock.insert(path.clone());
        return path;
    }
    
    let mut counter = 1;
    while path.exists() || lock.contains(&path) {
        filename = format!("{}{}_{}.{}", base_name, suffix, counter, extension);
        path = base_dir.join(&filename);
        counter += 1;
    }
    lock.insert(path.clone());
    path
}

pub fn process_single_file(
    input_path_str: &str,
    output_dir_str: &str,
    settings: &ToolSettings,
    app: &tauri::AppHandle,
    reserved_paths: &Mutex<HashSet<PathBuf>>,
) -> Result<String, String> {
    let input_path = Path::new(input_path_str);
    let output_dir = Path::new(output_dir_str);
    
    // Ensure output directory exists before any file operations
    if !output_dir.exists() {
        fs::create_dir_all(output_dir)
            .map_err(|e| format!("Failed to create output directory: {}", e))?;
    }
    
    if !input_path.exists() {
        return Err(format!("Input file does not exist: {}", input_path_str));
    }
    
    let _file_name = input_path.file_name()
        .ok_or_else(|| "Invalid input file name".to_string())?;
    
    let base_name = input_path.file_stem()
        .ok_or_else(|| "Invalid input file stem".to_string())?
        .to_string_lossy();
    
    // Check if tool is Metadata Action
    if let ToolSettings::Metadata { action, updates: _ } = settings {
        if action == "read" {
            let tags = read_exif_tags(input_path)?;
            let tags_json = serde_json::to_string(&tags)
                .map_err(|e| format!("Failed to serialize EXIF: {}", e))?;
            return Ok(format!("EXIF_READ:{}", tags_json));
        } else if action == "strip" {
            let out_ext = input_path.extension().unwrap_or_default().to_string_lossy().to_string();
            let output_path = get_unique_output_path(output_dir, &base_name, "_stripped", &out_ext, reserved_paths);
            let final_filename = output_path.file_name().unwrap().to_string_lossy().to_string();
            
            // Re-saving using image crate strips metadata
            let img = image::open(input_path).map_err(|e| format!("Failed to open image: {}", e))?;
            img.save(&output_path).map_err(|e| format!("Failed to strip and save image: {}", e))?;
            return Ok(format!("Stripped image saved as {}", final_filename));
        } else if action == "update" {
            let out_ext = input_path.extension().unwrap_or_default().to_string_lossy().to_string();
            let output_path = get_unique_output_path(output_dir, &base_name, "_updated", &out_ext, reserved_paths);
            let final_filename = output_path.file_name().unwrap().to_string_lossy().to_string();
            
            let img = image::open(input_path).map_err(|e| format!("Failed to open image: {}", e))?;
            img.save(&output_path).map_err(|e| format!("Failed to write updated image: {}", e))?;
            return Ok(format!("Image saved as {}. EXIF updating mock completed.", final_filename));
        }
    }
    
    // Load image for all other operations
    let img = image::open(input_path)
        .map_err(|e| format!("Failed to open image: {}", e))?;
    
    match settings {
        ToolSettings::Convert { format, quality, background_fill } => {
            let extension = format.trim_start_matches('.').to_lowercase();
            let output_path = get_unique_output_path(output_dir, &base_name, "_converted", &extension, reserved_paths);
            let final_filename = output_path.file_name().unwrap().to_string_lossy().to_string();
            
            // Flatten background if transparency exists
            let processed_img = if img.color().has_alpha() {
                flatten_image_background(&img, background_fill)
            } else {
                img.clone()
            };
            
            save_image(&processed_img, &output_path, &extension, *quality)?;
            Ok(format!("Saved as {}", final_filename))
        }
        ToolSettings::CropRotate { rotation, crop } => {
            let mut processed = apply_rotation(img, rotation, input_path)?;
            if let Some(crop_cfg) = crop {
                processed = apply_crop(processed, crop_cfg)?;
            }
            
            let out_ext = input_path.extension().unwrap_or_default().to_string_lossy().to_string();
            let output_path = get_unique_output_path(output_dir, &base_name, "_crop_rotate", &out_ext, reserved_paths);
            let final_filename = output_path.file_name().unwrap().to_string_lossy().to_string();
            
            processed.save(&output_path)
                .map_err(|e| format!("Failed to save crop/rotate image: {}", e))?;
            Ok(format!("Saved as {}", final_filename))
        }
        ToolSettings::Resize { method, width, height, percentage } => {
            let processed = apply_resize(img, method, *width, *height, *percentage)?;
            
            let out_ext = input_path.extension().unwrap_or_default().to_string_lossy().to_string();
            let output_path = get_unique_output_path(output_dir, &base_name, "_resized", &out_ext, reserved_paths);
            let final_filename = output_path.file_name().unwrap().to_string_lossy().to_string();
            
            processed.save(&output_path)
                .map_err(|e| format!("Failed to save resized image: {}", e))?;
            Ok(format!("Saved as {}", final_filename))
        }
        ToolSettings::Watermark { watermark_type, text_config, image_config } => {
            let processed = if watermark_type == "text" {
                let text_cfg = text_config.as_ref()
                    .ok_or_else(|| "Text configuration is missing".to_string())?;
                
                let font_path = app.path().resolve("resources/Roboto-Regular.ttf", BaseDirectory::Resource)
                    .map_err(|e| format!("Failed to resolve font resource path: {}", e))?;
                
                let font_bytes = fs::read(&font_path)
                    .map_err(|e| format!(
                        "Failed to read font file at {:?}: {}. Please check that the Roboto-Regular.ttf is placed in the resources folder.",
                        font_path, e
                    ))?;
                
                apply_text_watermark(img, text_cfg, &font_bytes)?
            } else {
                let img_cfg = image_config.as_ref()
                    .ok_or_else(|| "Image configuration is missing".to_string())?;
                
                if img_cfg.path.trim().is_empty() {
                    return Err("No watermark overlay image selected.".to_string());
                }
                
                apply_image_watermark(img, img_cfg)?
            };
            
            let out_ext = input_path.extension().unwrap_or_default().to_string_lossy().to_string();
            let output_path = get_unique_output_path(output_dir, &base_name, "_watermarked", &out_ext, reserved_paths);
            let final_filename = output_path.file_name().unwrap().to_string_lossy().to_string();
            
            processed.save(&output_path)
                .map_err(|e| format!("Failed to save watermarked image: {}", e))?;
            Ok(format!("Saved as {}", final_filename))
        }
        _ => Err("Invalid tool configuration state".to_string()),
    }
}

/// Spawns a background thread to process a batch of files concurrently using Rayon.
pub async fn process_batch(
    app: tauri::AppHandle,
    files: Vec<String>,
    output_dir: String,
    settings: ToolSettings,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let total = files.len();
        let completed = Arc::new(AtomicUsize::new(0));
        let reserved_paths = Arc::new(Mutex::new(HashSet::new()));
        
        files.into_par_iter().enumerate().for_each(|(i, filepath)| {
            let app_clone = app.clone();
            let completed_clone = completed.clone();
            let reserved_paths_clone = reserved_paths.clone();
            
            // Notify starting
            let _ = app_clone.emit("process-progress", ProgressPayload {
                file_path: filepath.clone(),
                index: i + 1,
                total,
                status: "processing".to_string(),
                message: "Starting...".to_string(),
            });
            
            // Execute processing
            let result = process_single_file(&filepath, &output_dir, &settings, &app_clone, &reserved_paths_clone);
            
            // Update counter
            let current_completed = completed_clone.fetch_add(1, Ordering::SeqCst) + 1;
            
            // Notify completion/error
            match result {
                Ok(msg) => {
                    let _ = app_clone.emit("process-progress", ProgressPayload {
                        file_path: filepath,
                        index: current_completed,
                        total,
                        status: "success".to_string(),
                        message: msg,
                    });
                }
                Err(e) => {
                    let _ = app_clone.emit("process-progress", ProgressPayload {
                        file_path: filepath,
                        index: current_completed,
                        total,
                        status: "error".to_string(),
                        message: e,
                    });
                }
            }
        });
    })
    .await
    .map_err(|e| format!("Task spawning failed: {}", e))?;
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;

    #[test]
    fn test_unique_output_path() {
        let temp_dir = std::env::temp_dir();
        let base_name = "test_image";
        let suffix = "_converted";
        let extension = "png";
        let reserved = Mutex::new(HashSet::new());

        // Clean up any existing test files in temp directory
        let path1 = temp_dir.join("test_image_converted.png");
        let path2 = temp_dir.join("test_image_converted_1.png");
        let path3 = temp_dir.join("test_image_converted_2.png");
        let _ = std::fs::remove_file(&path1);
        let _ = std::fs::remove_file(&path2);
        let _ = std::fs::remove_file(&path3);

        // 1st run: file should not exist, should return base path
        let resolved_path1 = get_unique_output_path(&temp_dir, base_name, suffix, extension, &reserved);
        assert_eq!(resolved_path1, path1);

        // Create the file so it exists
        File::create(&resolved_path1).unwrap();

        // 2nd run: file exists, should return _1 path
        let resolved_path2 = get_unique_output_path(&temp_dir, base_name, suffix, extension, &reserved);
        assert_eq!(resolved_path2, path2);

        // Create the _1 file
        File::create(&resolved_path2).unwrap();

        // 3rd run: both exist, should return _2 path
        let resolved_path3 = get_unique_output_path(&temp_dir, base_name, suffix, extension, &reserved);
        assert_eq!(resolved_path3, path3);

        // Clean up
        let _ = std::fs::remove_file(&path1);
        let _ = std::fs::remove_file(&path2);
    }
}

