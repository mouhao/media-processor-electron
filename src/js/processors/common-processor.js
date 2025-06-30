const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

// 报告进度 (需要从主进程传入回调)
function reportProgress(progressCallback, progress) {
    if (progressCallback) {
        progressCallback(progress);
    }
}

// 检查 FFmpeg 是否可用
async function checkFfmpeg() {
    return new Promise((resolve) => {
        const ffmpeg = spawn('ffmpeg', ['-version'], { stdio: 'pipe' });
        
        ffmpeg.on('error', () => resolve(false));
        ffmpeg.on('close', (code) => resolve(code === 0));
        
        setTimeout(() => {
            ffmpeg.kill();
            resolve(false);
        }, 5000);
    });
}

// 扫描文件夹中的媒体文件
async function scanMediaFiles(folderPath) {
    const mp3Files = [];
    const videoFiles = [];

    const mp3Extensions = ['.mp3'];
    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm'];

    try {
        await scanDirectory(folderPath, mp3Extensions, videoExtensions, mp3Files, videoFiles);
        return {
            mp3: mp3Files,
            video: videoFiles
        };
    } catch (error) {
        throw new Error(`扫描文件夹失败: ${error.message}`);
    }
}

// 递归扫描目录
async function scanDirectory(dirPath, mp3Extensions, videoExtensions, mp3Files, videoFiles) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            await scanDirectory(fullPath, mp3Extensions, videoExtensions, mp3Files, videoFiles);
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            const stats = await fs.stat(fullPath);
            
            if (mp3Extensions.includes(ext)) {
                mp3Files.push({ name: entry.name, path: fullPath, size: stats.size, info: '点击处理时获取详情' });
            } else if (videoExtensions.includes(ext)) {
                videoFiles.push({ name: entry.name, path: fullPath, size: stats.size, info: '点击处理时获取详情' });
            }
        }
    }
}

// 获取文件详细信息
async function getFileDetails(filePath, fileType) {
    try {
        if (fileType === 'mp3') {
            const bitrate = await getMp3Bitrate(filePath);
            return { info: bitrate ? `${bitrate} kbps` : '未知比特率' };
        } else if (fileType === 'video') {
            const duration = await getVideoDuration(filePath);
            return { info: duration ? formatDuration(duration) : '未知时长' };
        }
        return { info: '未知类型' };
    } catch (error) {
        return { info: '获取信息失败' };
    }
}

// 使用 ffprobe 获取元数据
function runFfprobe(args) {
    return new Promise((resolve, reject) => {
        const ffprobe = spawn('ffprobe', args);
        let output = '';
        let errorOutput = '';

        ffprobe.stdout.on('data', (data) => { output += data.toString(); });
        ffprobe.stderr.on('data', (data) => { errorOutput += data.toString(); });
        
        ffprobe.on('close', (code) => {
            if (code === 0) {
                resolve(JSON.parse(output));
            } else {
                reject(new Error(`ffprobe exited with code ${code}: ${errorOutput}`));
            }
        });

        ffprobe.on('error', (err) => reject(err));
    });
}

async function getMp3Bitrate(filePath) {
    try {
        const info = await runFfprobe(['-v', 'quiet', '-print_format', 'json', '-show_format', filePath]);
        return info.format && info.format.bit_rate ? Math.round(parseInt(info.format.bit_rate) / 1000) : null;
    } catch (error) {
        console.error(`Error getting bitrate for ${filePath}:`, error);
        return null;
    }
}

async function getVideoDuration(filePath) {
    try {
        const info = await runFfprobe(['-v', 'quiet', '-print_format', 'json', '-show_format', filePath]);
        return info.format && info.format.duration ? parseFloat(info.format.duration) : null;
    } catch (error) {
        console.error(`Error getting duration for ${filePath}:`, error);
        return null;
    }
}

// 格式化时长
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
}

module.exports = {
    reportProgress,
    checkFfmpeg,
    scanMediaFiles,
    getFileDetails,
    getMp3Bitrate,
}; 