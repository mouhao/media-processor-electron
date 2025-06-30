const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

class MediaProcessor {
    constructor() {
        this.progressCallback = null;
    }

    setProgressCallback(callback) {
        this.progressCallback = callback;
    }

    // 报告进度
    reportProgress(progress) {
        if (this.progressCallback) {
            this.progressCallback(progress);
        }
    }

    // 检查 FFmpeg 是否可用
    async checkFfmpeg() {
        return new Promise((resolve) => {
            const ffmpeg = spawn('ffmpeg', ['-version'], { stdio: 'pipe' });
            
            ffmpeg.on('error', () => resolve(false));
            ffmpeg.on('close', (code) => resolve(code === 0));
            
            // 超时处理
            setTimeout(() => {
                ffmpeg.kill();
                resolve(false);
            }, 5000);
        });
    }

    // 扫描文件夹中的媒体文件
    async scanMediaFiles(folderPath) {
        const mp3Files = [];
        const videoFiles = [];

        const mp3Extensions = ['.mp3'];
        const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm'];

        try {
            await this.scanDirectory(folderPath, mp3Extensions, videoExtensions, mp3Files, videoFiles);
            
            return {
                mp3: mp3Files,
                video: videoFiles
            };
        } catch (error) {
            throw new Error(`扫描文件夹失败: ${error.message}`);
        }
    }

    // 递归扫描目录
    async scanDirectory(dirPath, mp3Extensions, videoExtensions, mp3Files, videoFiles) {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                await this.scanDirectory(fullPath, mp3Extensions, videoExtensions, mp3Files, videoFiles);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                
                if (mp3Extensions.includes(ext)) {
                    const stats = await fs.stat(fullPath);
                    mp3Files.push({
                        name: entry.name,
                        path: fullPath,
                        size: stats.size,
                        info: '点击处理时获取详情' // 推迟到处理时再获取
                    });
                } else if (videoExtensions.includes(ext)) {
                    const stats = await fs.stat(fullPath);
                    videoFiles.push({
                        name: entry.name,
                        path: fullPath,
                        size: stats.size,
                        info: '点击处理时获取详情' // 推迟到处理时再获取
                    });
                }
            }
        }
    }

    // 获取MP3文件信息
    async getMp3FileInfo(filePath) {
        try {
            const stats = await fs.stat(filePath);
            const bitrate = await this.getMp3Bitrate(filePath);
            
            return {
                size: stats.size,
                info: bitrate ? `${bitrate} kbps` : '未知比特率'
            };
        } catch (error) {
            return {
                size: 0,
                info: '获取信息失败'
            };
        }
    }

    // 获取视频文件信息
    async getVideoFileInfo(filePath) {
        try {
            const stats = await fs.stat(filePath);
            const duration = await this.getVideoDuration(filePath);
            
            return {
                size: stats.size,
                info: duration ? this.formatDuration(duration) : '未知时长'
            };
        } catch (error) {
            return {
                size: 0,
                info: '获取信息失败'
            };
        }
    }

    // 获取MP3比特率
    async getMp3Bitrate(filePath) {
        return new Promise((resolve) => {
            const ffprobe = spawn('ffprobe', [
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                filePath
            ]);

            let output = '';
            ffprobe.stdout.on('data', (data) => {
                output += data.toString();
            });

            ffprobe.on('close', () => {
                try {
                    const info = JSON.parse(output);
                    const bitrate = info.format && info.format.bit_rate 
                        ? Math.round(parseInt(info.format.bit_rate) / 1000)
                        : null;
                    resolve(bitrate);
                } catch (error) {
                    resolve(null);
                }
            });

            ffprobe.on('error', () => resolve(null));
        });
    }

    // 获取视频时长
    async getVideoDuration(filePath) {
        return new Promise((resolve) => {
            const ffprobe = spawn('ffprobe', [
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                filePath
            ]);

            let output = '';
            ffprobe.stdout.on('data', (data) => {
                output += data.toString();
            });

            ffprobe.on('close', () => {
                try {
                    const info = JSON.parse(output);
                    const duration = info.format && info.format.duration 
                        ? parseFloat(info.format.duration)
                        : null;
                    resolve(duration);
                } catch (error) {
                    resolve(null);
                }
            });

            ffprobe.on('error', () => resolve(null));
        });
    }

    // 格式化时长
    formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${secs.toString().padStart(2, '0')}`;
        }
    }

    // 获取单个文件的详细信息
    async getFileDetails(filePath, fileType) {
        if (fileType === 'mp3') {
            return await this.getMp3FileInfo(filePath);
        } else if (fileType === 'video') {
            return await this.getVideoFileInfo(filePath);
        }
        return { size: 0, info: '未知类型' };
    }

    // 处理MP3文件
    async processMp3Files(folderPath, files, options) {
        const { bitrate = 64, threshold = 64, keepStructure = true, forceProcess = false } = options;
        const outputDir = path.join(folderPath, 'output');
        
        // 创建输出目录
        await fs.mkdir(outputDir, { recursive: true });

        const results = [];
        let processed = 0;

        for (const file of files) {
            try {
                this.reportProgress({
                    current: processed,
                    total: files.length,
                    file: file.name,
                    status: 'processing'
                });

                // 检查文件比特率（只在处理时获取）
                const currentBitrate = await this.getMp3Bitrate(file.path);
                
                // 只有在非强制模式下且成功获取到比特率时才检查阈值
                if (!forceProcess && currentBitrate && currentBitrate <= threshold) {
                    results.push({
                        file: file.name,
                        status: 'skipped',
                        message: `跳过: 当前比特率 ${currentBitrate}kbps <= 阈值 ${threshold}kbps`
                    });
                    processed++;
                    continue;
                }

                // 确定输出路径
                let outputPath;
                if (keepStructure) {
                    const relativePath = path.relative(folderPath, file.path);
                    outputPath = path.join(outputDir, relativePath);
                    await fs.mkdir(path.dirname(outputPath), { recursive: true });
                } else {
                    outputPath = path.join(outputDir, file.name);
                }

                // 处理文件
                await this.compressMp3(file.path, outputPath, bitrate);
                
                results.push({
                    file: file.name,
                    status: 'success',
                    message: `压缩完成: ${currentBitrate ? currentBitrate + 'kbps' : '未知'} → ${bitrate}kbps`
                });

            } catch (error) {
                results.push({
                    file: file.name,
                    status: 'error',
                    message: `处理失败: ${error.message}`
                });
            }

            processed++;
        }

        this.reportProgress({
            current: files.length,
            total: files.length,
            status: 'complete'
        });

        // 统计处理结果
        const successCount = results.filter(r => r.status === 'success').length;
        const skippedCount = results.filter(r => r.status === 'skipped').length;
        const failedCount = results.filter(r => r.status === 'error').length;

        return {
            processed: successCount,
            skipped: skippedCount,
            failed: failedCount,
            details: results
        };
    }

    // 压缩MP3文件
    async compressMp3(inputPath, outputPath, bitrate) {
        return new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-i', inputPath,
                '-ab', `${bitrate}k`,
                '-map', 'a',
                '-y',
                outputPath
            ]);

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`FFmpeg进程退出，代码: ${code}`));
                }
            });

            ffmpeg.on('error', (error) => {
                reject(new Error(`FFmpeg错误: ${error.message}`));
            });
        });
    }

    // 处理视频文件
    async processVideoFiles(folderPath, files, options) {
        const { 
            lessonName = 'lesson', 
            resolution = '1080p',
            bitrate = '2000',
            segmentDuration = 10,
            rename = true 
        } = options;
        
        const outputDir = path.join(folderPath, 'output');
        await fs.mkdir(outputDir, { recursive: true });

        const results = [];
        let processed = 0;

        for (const file of files) {
            try {
                this.reportProgress({
                    current: processed,
                    total: files.length,
                    file: file.name,
                    status: 'processing'
                });

                // 确定输出文件名
                const baseName = rename 
                    ? `${lessonName}_${(processed + 1).toString().padStart(3, '0')}`
                    : path.parse(file.name).name;

                const outputPath = path.join(outputDir, baseName);

                // 处理视频
                await this.processVideo(file.path, outputPath, {
                    resolution,
                    bitrate,
                    segmentDuration
                });

                results.push({
                    file: file.name,
                    status: 'success',
                    message: `处理完成: ${resolution} ${bitrate}k`
                });

            } catch (error) {
                results.push({
                    file: file.name,
                    status: 'error',
                    message: `处理失败: ${error.message}`
                });
            }

            processed++;
        }

        this.reportProgress({
            current: files.length,
            total: files.length,
            status: 'complete'
        });

        // 统计处理结果
        const successCount = results.filter(r => r.status === 'success').length;
        const failedCount = results.filter(r => r.status === 'error').length;

        return {
            processed: successCount,
            failed: failedCount,
            details: results
        };
    }

    // 处理单个视频文件
    async processVideo(inputPath, outputBasePath, options) {
        const { resolution, bitrate, segmentDuration } = options;
        
        // 获取分辨率参数
        const resolutionMap = {
            '720p': '1280:720',
            '1080p': '1920:1080'
        };
        
        const scale = resolutionMap[resolution] || '1920:1080';
        
        return new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-i', inputPath,
                '-c:v', 'libx264',
                '-b:v', `${bitrate}k`,
                '-c:a', 'aac',
                '-b:a', '128k',
                '-vf', `scale=${scale}`,
                '-hls_time', segmentDuration.toString(),
                '-hls_list_size', '0',
                '-f', 'hls',
                '-y',
                `${outputBasePath}.m3u8`
            ]);

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`FFmpeg进程退出，代码: ${code}`));
                }
            });

            ffmpeg.on('error', (error) => {
                reject(new Error(`FFmpeg错误: ${error.message}`));
            });
        });
    }
}

module.exports = MediaProcessor; 