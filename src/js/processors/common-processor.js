const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

// 新增：获取FFmpeg和ffprobe的路径
function getFfmpegPaths() {
    const isPackaged = app.isPackaged;
    const isMac = process.platform === 'darwin';
    const isWin = process.platform === 'win32';

    // 调试信息
    console.log('FFmpeg路径调试:', { 
        isPackaged, 
        platform: process.platform,
        resourcesPath: isPackaged ? process.resourcesPath : '(开发模式)'
    });

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
    
    // 调试输出最终路径
    console.log('计算出的FFmpeg路径:', { ffmpegPath, ffprobePath });
    
    if (!ffmpegPath || !ffprobePath) {
        // 如果平台不支持或路径未定义，则返回null
        console.error('FFmpeg路径未找到或平台不支持');
        return { ffmpegPath: null, ffprobePath: null };
    }

    // 检查文件是否存在
    const fs = require('fs');
    const ffmpegExists = fs.existsSync(ffmpegPath);
    const ffprobeExists = fs.existsSync(ffprobePath);
    
    console.log('FFmpeg文件存在性检查:', { 
        ffmpegExists, 
        ffprobeExists,
        ffmpegPath: ffmpegExists ? '✅' : '❌',
        ffprobePath: ffprobeExists ? '✅' : '❌'
    });

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

// 处理选中的文件列表
async function processSelectedFiles(filePaths) {
    const mp3Files = [];
    const videoFiles = [];

    const mp3Extensions = ['.mp3', '.wav', '.flac', '.aac', '.m4a'];
    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm'];

    try {
        for (const filePath of filePaths) {
            const ext = path.extname(filePath).toLowerCase();
            const fileName = path.basename(filePath);
            
            // 检查文件是否存在
            try {
                const stats = await fs.stat(filePath);
                
                if (mp3Extensions.includes(ext)) {
                    mp3Files.push({ 
                        name: fileName, 
                        path: filePath, 
                        size: stats.size, 
                        info: '点击处理时获取详情' 
                    });
                } else if (videoExtensions.includes(ext)) {
                    videoFiles.push({ 
                        name: fileName, 
                        path: filePath, 
                        size: stats.size, 
                        info: '点击处理时获取详情' 
                    });
                }
            } catch (error) {
                console.warn(`无法访问文件: ${filePath}, 错误: ${error.message}`);
            }
        }

        return {
            mp3: mp3Files,
            video: videoFiles,
            compose: videoFiles, // 视频合成使用相同的视频列表
            'intro-outro': videoFiles // 片头片尾处理也使用视频列表
        };
    } catch (error) {
        throw new Error(`处理选中文件失败: ${error.message}`);
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
            const videoInfo = await getDetailedVideoInfo(filePath);
            return { info: videoInfo };
        }
        return { info: '未知类型' };
    } catch (error) {
        return { info: '获取信息失败' };
    }
}

// 获取详细的视频信息
async function getDetailedVideoInfo(filePath) {
    try {
        const info = await runFfprobe([
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            filePath
        ]);

        if (!info.streams || info.streams.length === 0) {
            return '无法获取流信息';
        }

        // 查找视频流
        const videoStream = info.streams.find(stream => stream.codec_type === 'video');
        
        if (!videoStream) {
            return '未找到视频流';
        }

        // 提取视频信息
        const width = videoStream.width || '未知';
        const height = videoStream.height || '未知';
        const resolution = `${width}x${height}`;
        
        // 计算帧率
        let frameRate = '未知';
        if (videoStream.r_frame_rate) {
            const [num, den] = videoStream.r_frame_rate.split('/');
            if (den && parseInt(den) !== 0) {
                frameRate = Math.round((parseInt(num) / parseInt(den)) * 100) / 100;
            }
        }
        
        // 获取比特率
        let bitrate = '未知';
        if (videoStream.bit_rate) {
            bitrate = `${Math.round(parseInt(videoStream.bit_rate) / 1000)}k`;
        } else if (info.format && info.format.bit_rate) {
            bitrate = `${Math.round(parseInt(info.format.bit_rate) / 1000)}k`;
        }
        
        // 获取编码格式
        const codec = videoStream.codec_name || '未知';
        const codecLong = videoStream.codec_long_name || codec;
        
        // 获取编码profile
        let profile = '未知';
        if (videoStream.profile) {
            profile = videoStream.profile;
        }
        
        // 获取时长
        let duration = '未知';
        if (info.format && info.format.duration) {
            duration = formatDuration(parseFloat(info.format.duration));
        }

        // 组装信息字符串，使用HTML格式化
        return `
            <div class="video-info-detail">
                <div class="info-row"><span class="label">分辨率:</span> ${resolution}</div>
                <div class="info-row"><span class="label">帧率:</span> ${frameRate} fps</div>
                <div class="info-row"><span class="label">比特率:</span> ${bitrate}bps</div>
                <div class="info-row"><span class="label">编码:</span> ${codec.toUpperCase()}</div>
                <div class="info-row"><span class="label">Profile:</span> ${profile}</div>
                <div class="info-row"><span class="label">时长:</span> ${duration}</div>
            </div>
        `;
        
    } catch (error) {
        console.error(`Error getting detailed video info for ${filePath}:`, error);
        return '获取详细信息失败';
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

// 延迟获取FFmpeg路径的函数，确保在需要时才获取
function getLazyFFmpegPaths() {
    return getFfmpegPaths();
}

// 获取ffmpegPath（延迟加载）
function getFFmpegPath() {
    const { ffmpegPath } = getLazyFFmpegPaths();
    if (!ffmpegPath) {
        throw new Error('FFmpeg路径未找到，请检查安装配置');
    }
    return ffmpegPath;
}

// 获取ffprobePath（延迟加载）
function getFFprobePath() {
    const { ffprobePath } = getLazyFFmpegPaths();
    if (!ffprobePath) {
        throw new Error('FFprobe路径未找到，请检查安装配置');
    }
    return ffprobePath;
}

/**
 * 生成不重复的输出文件名，如果目标文件已存在，自动添加后缀
 * @param {string} targetPath - 目标文件路径
 * @param {Function} logCallback - 日志回调函数
 * @returns {Promise<string>} - 返回不重复的文件路径
 */
async function generateUniqueFilename(targetPath, logCallback = null) {
    try {
        // 检查文件是否存在
        await fs.access(targetPath);
        
        // 文件存在，需要生成新名称
        const dir = path.dirname(targetPath);
        const ext = path.extname(targetPath);
        const nameWithoutExt = path.basename(targetPath, ext);
        
        let counter = 1;
        let newPath;
        
        do {
            const newName = `${nameWithoutExt}_${counter}${ext}`;
            newPath = path.join(dir, newName);
            
            try {
                await fs.access(newPath);
                counter++; // 文件存在，继续尝试下一个
            } catch {
                // 文件不存在，找到可用的名称
                break;
            }
        } while (counter < 1000); // 防止无限循环
        
        if (counter >= 1000) {
            throw new Error('无法生成唯一文件名，请检查输出目录');
        }
        
        if (logCallback) {
            logCallback('info', `📝 检测到重名文件，重命名为: ${path.basename(newPath)}`);
        }
        
        return newPath;
        
    } catch (error) {
        if (error.code === 'ENOENT') {
            // 文件不存在，可以使用原名称
            return targetPath;
        }
        throw error;
    }
}

/**
 * 获取跨平台硬件加速参数
 */
function getHardwareAccelArgs() {
    if (process.platform === 'darwin') {
        // macOS: 使用VideoToolbox
        return ['-hwaccel', 'videotoolbox'];
    } else if (process.platform === 'win32') {
        // Windows: 优先使用D3D11VA，降级到DXVA2
        return ['-hwaccel', 'd3d11va', '-hwaccel_output_format', 'd3d11'];
    } else {
        // Linux: 尝试VAAPI硬件加速
        return ['-hwaccel', 'vaapi', '-hwaccel_output_format', 'vaapi'];
    }
}

/**
 * 获取与过滤器兼容的硬件加速参数
 * 在Windows下不使用硬件输出格式，避免与overlay/filter_complex过滤器的兼容性问题
 */
function getFilterCompatibleHwAccelArgs() {
    if (process.platform === 'darwin') {
        // macOS: 使用VideoToolbox（通常兼容过滤器）
        return ['-hwaccel', 'videotoolbox'];
    } else if (process.platform === 'win32') {
        // Windows: 使用硬件解码但不使用硬件输出格式，避免D3D11兼容性问题
        return ['-hwaccel', 'd3d11va'];
    } else {
        // Linux: 使用VAAPI但不指定输出格式
        return ['-hwaccel', 'vaapi'];
    }
}

/**
 * 获取跨平台最佳硬件编码器
 */
function getBestHardwareEncoder(codec = 'h264', logCallback = null) {
    if (process.platform === 'darwin') {
        // macOS: 使用VideoToolbox
        const encoder = codec === 'hevc' ? 'hevc_videotoolbox' : 'h264_videotoolbox';
        if (logCallback) {
            logCallback('info', `🍎 macOS使用VideoToolbox硬件编码: ${encoder}`);
        }
        return encoder;
    } else if (process.platform === 'win32') {
        // Windows: 智能选择 NVENC > AMF > 软件编码
        // 注意：实际检测需要运行FFmpeg命令，这里使用软件编码作为兼容方案
        const softwareEncoder = codec === 'hevc' ? 'libx265' : 'libx264';
        if (logCallback) {
            logCallback('info', `🪟 Windows使用软件编码 (兼容性): ${softwareEncoder}`);
        }
        return softwareEncoder;
    } else {
        // Linux: 使用软件编码
        const encoder = codec === 'hevc' ? 'libx265' : 'libx264';
        if (logCallback) {
            logCallback('info', `🐧 Linux使用软件编码: ${encoder}`);
        }
        return encoder;
    }
}

/**
 * 获取硬件加速类型显示名称
 */
function getAccelerationType() {
    if (process.platform === 'darwin') {
        return 'VideoToolbox';
    } else if (process.platform === 'win32') {
        return 'D3D11VA';
    } else {
        return 'VAAPI/软件';
    }
}

module.exports = {
    reportProgress,
    checkFfmpeg,
    scanMediaFiles,
    processSelectedFiles,
    getFileDetails,
    getMp3Bitrate,
    generateUniqueFilename,
    getHardwareAccelArgs,
    getFilterCompatibleHwAccelArgs,
    getBestHardwareEncoder,
    getAccelerationType,
    ffmpegPath: getFFmpegPath,
    ffprobePath: getFFprobePath,
    getFfmpegPaths,
}; 