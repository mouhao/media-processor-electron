const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

// 新增：获取FFmpeg和ffprobe的路径
function getFfmpegPaths() {
    const isPackaged = app.isPackaged;
    const isMac = process.platform === 'darwin';
    const isWin = process.platform === 'win32';

    let ffmpegPath, ffprobePath;

    if (isPackaged) {
        // 在打包后的应用中，可执行文件位于 resources 目录下
        const resourcesPath = process.resourcesPath;
        if (isMac) {
            ffmpegPath = path.join(resourcesPath, 'bin', 'mac', 'ffmpeg');
            ffprobePath = path.join(resourcesPath, 'bin', 'mac', 'ffprobe');
        } else if (isWin) {
            ffmpegPath = path.join(resourcesPath, 'bin', 'win', 'ffmpeg.exe');
            ffprobePath = path.join(resourcesPath, 'bin', 'win', 'ffprobe.exe');
        }
    } else {
        // 在开发模式下，路径相对于项目根目录
        const basePath = path.join(__dirname, '..', '..', '..');
        if (isMac) {
            ffmpegPath = path.join(basePath, 'bin', 'mac', 'ffmpeg');
            ffprobePath = path.join(basePath, 'bin', 'mac', 'ffprobe');
        } else if (isWin) {
            ffmpegPath = path.join(basePath, 'bin', 'win', 'ffmpeg.exe');
            ffprobePath = path.join(basePath, 'bin', 'win', 'ffprobe.exe');
        }
    }
    
    if (!ffmpegPath || !ffprobePath) {
        // 如果平台不支持或路径未定义，则返回null
        return { ffmpegPath: null, ffprobePath: null };
    }

    return { ffmpegPath, ffprobePath };
}

// 报告进度 (需要从主进程传入回调)
function reportProgress(progressCallback, progress) {
    if (progressCallback) {
        progressCallback(progress);
    }
}

// 检查 FFmpeg 是否可用（超快速版本）
async function checkFfmpeg() {
  const { ffmpegPath, ffprobePath } = getFfmpegPaths();
  
  if (!ffmpegPath || !ffprobePath) {
      console.error('FFmpeg path not found for this platform.');
      return false;
  }
  
  // 检查文件是否存在
  const fs = require('fs');
  if (!fs.existsSync(ffmpegPath) || !fs.existsSync(ffprobePath)) {
      console.error('FFmpeg or ffprobe file does not exist');
      return false;
  }
  
  // 在 Unix 系统上检查执行权限
  if (process.platform !== 'win32') {
      try {
          const ffmpegStats = fs.statSync(ffmpegPath);
          const ffprobeStats = fs.statSync(ffprobePath);
          
          // 检查是否有执行权限 (owner execute permission)
          if (!(ffmpegStats.mode & parseInt('100', 8)) || !(ffprobeStats.mode & parseInt('100', 8))) {
              console.error('FFmpeg or ffprobe files do not have execute permission');
              return false;
          }
      } catch (error) {
          console.error('Error checking FFmpeg file permissions:', error);
          return false;
      }
  }
  
  // 所有检查都通过
  return true;
}

// 检查 FFmpeg 是否可用
async function checkFfmpeg_old() {
    return new Promise((resolve) => {
        const { ffmpegPath } = getFfmpegPaths();
        
        if (!ffmpegPath) {
            console.error('FFmpeg path not found for this platform.');
            return resolve(false);
        }
        
        // 检查文件是否存在
        const fs = require('fs');
        if (!fs.existsSync(ffmpegPath)) {
            console.error('FFmpeg file does not exist at path:', ffmpegPath);
            return resolve(false);
        }
        
        const ffmpeg = spawn(ffmpegPath, ['-version'], { 
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false
        });
        
        let resolved = false;
        let errorOutput = '';
        
        ffmpeg.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        ffmpeg.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                console.error('Failed to start FFmpeg process:', err);
                resolve(false);
            }
        });
        
        ffmpeg.on('close', (code) => {
            if (!resolved) {
                resolved = true;
                if (code !== 0) {
                    console.error(`FFmpeg process exited with code ${code}. Stderr: ${errorOutput}`);
                }
                resolve(code === 0);
            }
        });
        
        // 超时保护
        const timeoutId = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                ffmpeg.kill('SIGTERM');
                console.error('FFmpeg check timed out');
                resolve(false);
            }
        }, 5000);
        
        // 清理超时定时器
        ffmpeg.on('close', () => {
            clearTimeout(timeoutId);
        });
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
        const { ffprobePath } = getFfmpegPaths();
        if (!ffprobePath) {
            return reject(new Error('ffprobe not found for this platform.'));
        }

        const ffprobe = spawn(ffprobePath, args);
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

const { ffmpegPath, ffprobePath } = getFfmpegPaths();

module.exports = {
    reportProgress,
    checkFfmpeg,
    scanMediaFiles,
    getFileDetails,
    getMp3Bitrate,
    ffmpegPath,
    ffprobePath,
}; 