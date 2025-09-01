const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ffmpegPath, ffprobePath } = require('./common-processor');

/**
 * 运行FFprobe获取视频信息
 */
async function runFfprobe(args) {
    return new Promise((resolve, reject) => {
        const ffprobeExePath = ffprobePath();
        const ffprobe = spawn(ffprobeExePath, args);
        let output = '';
        let errorOutput = '';

        ffprobe.stdout.on('data', (data) => {
            output += data.toString();
        });

        ffprobe.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        ffprobe.on('close', (code) => {
            if (code === 0) {
                try {
                    resolve(JSON.parse(output));
                } catch (error) {
                    reject(new Error(`解析FFprobe输出失败: ${error.message}`));
                }
            } else {
                reject(new Error(`FFprobe执行失败 (退出码: ${code}): ${errorOutput}`));
            }
        });

        ffprobe.on('error', (error) => {
            reject(new Error(`启动FFprobe失败: ${error.message}`));
        });
    });
}

/**
 * 分析视频获取基本信息
 */
async function analyzeVideo(filePath, logCallback) {
    try {
        const info = await runFfprobe([
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            filePath
        ]);

        const videoStream = info.streams.find(s => s.codec_type === 'video');
        const audioStream = info.streams.find(s => s.codec_type === 'audio');

        if (!videoStream) {
            throw new Error('未找到视频流');
        }

        const duration = parseFloat(info.format.duration) || 0;
        const width = parseInt(videoStream.width) || 0;
        const height = parseInt(videoStream.height) || 0;
        const fps = eval(videoStream.r_frame_rate) || 25;

        return {
            duration,
            width,
            height,
            fps,
            videoCodec: videoStream.codec_name,
            audioCodec: audioStream ? audioStream.codec_name : null
        };
    } catch (error) {
        if (logCallback) {
            logCallback('warn', `⚠️ 获取视频信息失败: ${error.message}`);
        }
        return { duration: 0, width: 0, height: 0, fps: 25, videoCodec: 'unknown', audioCodec: 'unknown' };
    }
}

/**
 * 格式化时间显示
 */
function formatTime(seconds) {
    if (!seconds || seconds <= 0) return '00:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
}

/**
 * 执行FFmpeg命令（支持精确进度显示）
 */
function executeFFmpeg(args, logCallback, progressCallback = null, totalDuration = null) {
    return new Promise((resolve, reject) => {
        const ffmpegExePath = ffmpegPath();
        if (!ffmpegExePath) {
            return reject(new Error('FFmpeg not found'));
        }

        const ffmpeg = spawn(ffmpegExePath, args);
        let stderr = '';
        let lastProgressTime = 0;
        
        ffmpeg.stderr.on('data', (data) => { 
            const chunk = data.toString();
            stderr += chunk;
            
            // 解析FFmpeg进度输出
            if (progressCallback && totalDuration && totalDuration > 0) {
                // 匹配 time=HH:MM:SS.ss 或 time=SS.ss 格式
                const timeMatch = chunk.match(/time=([\d\.:]+)/);
                if (timeMatch) {
                    const timeStr = timeMatch[1];
                    let currentTime = 0;
                    
                    // 解析时间格式
                    if (timeStr.includes(':')) {
                        // HH:MM:SS.ss 格式
                        const timeParts = timeStr.split(':');
                        if (timeParts.length === 3) {
                            const hours = parseFloat(timeParts[0]) || 0;
                            const minutes = parseFloat(timeParts[1]) || 0;
                            const seconds = parseFloat(timeParts[2]) || 0;
                            currentTime = hours * 3600 + minutes * 60 + seconds;
                        }
                    } else {
                        // 直接是秒数
                        currentTime = parseFloat(timeStr) || 0;
                    }
                    
                    // 计算进度百分比
                    if (currentTime > lastProgressTime) {
                        lastProgressTime = currentTime;
                        const rawProgressPercent = (currentTime / totalDuration) * 100;
                        const progressPercent = Math.min(rawProgressPercent, 99); // 最大99%，真正的100%由进程结束时触发
                        
                        // 回调真实进度更新
                        progressCallback({
                            current: Math.round(progressPercent),
                            total: 100,
                            currentTime: currentTime,
                            totalDuration: totalDuration,
                            status: 'processing',
                            file: `处理中... ${Math.round(progressPercent)}% (${formatTime(currentTime)}/${formatTime(totalDuration)})`
                        });
                    }
                }
            }
        });
        
        ffmpeg.on('close', (code) => {
            if (code === 0) {
                if (progressCallback) {
                    progressCallback({
                        current: 100,
                        total: 100,
                        status: 'complete',
                        file: '处理完成'
                    });
                }
                resolve();
            } else {
                reject(new Error(`FFmpeg处理失败 (退出码: ${code}): ${stderr}`));
            }
        });

        ffmpeg.on('error', (error) => {
            reject(new Error(`启动FFmpeg失败: ${error.message}`));
        });
    });
}

async function processVideoFiles(progressCallback, logCallback, folderPath, outputPath, files, options, shouldStopCallback = null) {
    const outputDir = outputPath; // 直接使用输出路径，不添加video_output子文件夹
    await fs.mkdir(outputDir, { recursive: true });

    let processedCount = 0;
    const totalFiles = files.length;
    const results = { processed: 0, failed: 0 };
    
    // 初始化进度
    if (progressCallback) {
        progressCallback({ current: 0, total: totalFiles, status: 'analyzing', file: '正在分析视频文件...' });
    }

    for (const file of files) {
        // 检查是否应该停止处理
        if (shouldStopCallback && shouldStopCallback()) {
            if (logCallback) {
                logCallback('warning', '⏹️ 处理被用户停止');
            }
            throw new Error('处理被用户停止');
        }
        
        try {
            // 创建单个文件的进度回调函数
            const fileProgressCallback = progressCallback ? (progress) => {
                // 将单个文件的进度转换为整体进度
                const overallProgress = Math.round((processedCount / totalFiles) * 100 + (progress.current / totalFiles));
                progressCallback({
                    current: Math.min(overallProgress, 99), // 确保不超过99%
                    total: 100,
                    currentTime: progress.currentTime,
                    totalDuration: progress.totalDuration,
                    status: progress.status,
                    file: `[${processedCount + 1}/${totalFiles}] ${file.name} - ${progress.file}`
                });
            } : null;

            await processVideo(file.path, outputDir, options, logCallback, fileProgressCallback);
            results.processed++;
            if (logCallback) {
                logCallback('success', `✅ ${file.name} 视频处理成功`);
            }
        } catch (error) {
            console.error(`Error processing video ${file.name}:`, error);
            results.failed++;
            if (logCallback) {
                logCallback('error', `❌ ${file.name} 视频处理失败: ${error.message}`);
            }
        }
        processedCount++;
    }
    
    // 最终进度更新
    if (progressCallback) {
        progressCallback({
            current: 100,
            total: 100,
            status: 'complete',
            file: `处理完成: 成功 ${results.processed}, 失败 ${results.failed}`
        });
    }
    
    return results;
}

async function processVideo(inputPath, outputBasePath, options, logCallback, progressCallback = null) {
        if (!ffmpegPath) {
        throw new Error('FFmpeg not found. Please check your installation and configuration.');
        }
        
        const {
            resolution,
        quality,
            segmentDuration,
        rename,
        customWidth,
        customHeight,
        customProfile,
        customBitrate,
        customFramerate,
        customAudioBitrate,
        customAudioSamplerate,
        customPreset,
        // 新增高级优化选项
        scalingStrategy = 'smart-pad',
        colorEnhancement = true,
        bitrateControlMode = 'crf',
        mobileOptimization = true
        } = options;

        const fileExt = path.extname(inputPath);
        const baseName = path.basename(inputPath, fileExt);

    // 先分析视频获取时长信息
    const videoInfo = await analyzeVideo(inputPath, logCallback);
    
    if (logCallback) {
        logCallback('info', `📹 视频信息: ${videoInfo.width}x${videoInfo.height}, ${formatTime(videoInfo.duration)}, ${videoInfo.fps}fps`);
        logCallback('info', `🎞️ 编码: 视频=${videoInfo.videoCodec}, 音频=${videoInfo.audioCodec}`);
    }

    // 为每个视频文件创建独立的输出目录
    const outputDir = path.join(outputBasePath, baseName);
    
    try {
        fsSync.mkdirSync(outputDir, { recursive: true });
    } catch (error) {
        // 目录可能已存在，忽略错误
    }

    // 扩展的分辨率映射
        const resolutionMap = {
        '4k': '3840:2160',
        '2k': '2560:1440',
        '1080p': '1920:1080',
            '720p': '1280:720',
        '480p': '854:480'
    };

    // 获取分辨率参数
    let resolutionParam;
    if (resolution === 'custom') {
        resolutionParam = `${customWidth}:${customHeight}`;
    } else if (resolution === 'auto') {
        // 自动模式：不缩放，保持原始分辨率
        resolutionParam = null;
    } else {
        resolutionParam = resolutionMap[resolution];
    }

    // 构建FFmpeg参数
    const args = [];

    // === Mac硬件加速优化 ===
    if (process.platform === 'darwin') {
        // macOS: 启用VideoToolbox硬件解码加速（必须在-i之前）
        args.push('-hwaccel', 'videotoolbox');
        if (logCallback) {
            logCallback('info', '🍎 启用VideoToolbox硬件解码加速');
        }
    }
    
    // 添加输入文件参数
    args.push('-i', inputPath);

    // === 视频编码设置（Mac硬件编码优化）===
    let videoEncoder = 'libx264';
    let useMacHardwareAccel = false;
    
    if (process.platform === 'darwin') {
        // macOS: 优先使用硬件编码器
        videoEncoder = 'h264_videotoolbox';
        useMacHardwareAccel = true;
        if (logCallback) {
            logCallback('info', '🚀 使用VideoToolbox硬件编码器，显著提升处理速度');
        }
    }
    args.push('-c:v', videoEncoder);

    // 处理质量设置
    if (quality === 'custom') {
        // 自定义质量设置
        if (customProfile) {
            args.push('-profile:v', customProfile);
        }
        if (customBitrate) {
            args.push('-b:v', `${customBitrate}k`);
        }
        if (customFramerate) {
            args.push('-r', customFramerate.toString());
        }
        if (customPreset) {
            args.push('-preset', customPreset);
        }
    } else {
        // === Mac硬件编码器优化的质量设置 ===
        if (useMacHardwareAccel) {
            // VideoToolbox硬件编码器使用不同的参数体系
            const vtQualitySettings = {
                'high': { bitrate: '5000k', profile: 'main' },
                'medium': { bitrate: '3000k', profile: 'main' },
                'fast': { bitrate: '2000k', profile: 'baseline' }
            };
            
            const vtSetting = vtQualitySettings[quality] || vtQualitySettings['medium'];
            args.push('-profile:v', vtSetting.profile);
            args.push('-b:v', vtSetting.bitrate);
            
            // VideoToolbox专用参数：更快的编码速度
            args.push('-allow_sw', '1'); // 允许软件回退
            args.push('-realtime', '1'); // 实时编码模式，提升速度
            
            if (logCallback) {
                logCallback('info', `⚡ VideoToolbox质量: ${vtSetting.bitrate}, profile: ${vtSetting.profile}`);
            }
        } else {
            // 软件编码器的传统质量设置
            const qualitySettings = {
                'high': { crf: 18, preset: 'faster', profile: 'baseline' }, // 从slow改为faster
                'medium': { crf: 23, preset: 'faster', profile: 'baseline' }, // 从medium改为faster
                'fast': { crf: 28, preset: 'veryfast', profile: 'baseline' } // 从fast改为veryfast
            };
            
            const qualitySetting = qualitySettings[quality] || qualitySettings['medium'];
            
            // 添加编码规范兼容性
            if (qualitySetting.profile) {
                args.push('-profile:v', qualitySetting.profile);
            }
            if (qualitySetting.crf) {
                args.push('-crf', qualitySetting.crf.toString());
            }
            if (qualitySetting.preset) {
                args.push('-preset', qualitySetting.preset);
            }
            
            if (logCallback) {
                logCallback('info', `🔧 软件编码质量: CRF=${qualitySetting.crf}, preset=${qualitySetting.preset}`);
            }
        }
    }

    // === 新增：码率控制模式处理 ===
    if (bitrateControlMode === 'cbr' && quality !== 'custom') {
        // CBR模式：码率控制，移除CRF设置
        const cbrBitrates = { 'high': 5000, 'medium': 2000, 'fast': 1000 };
        const bitrate = cbrBitrates[quality] || 2000;
        
        // 移除之前添加的CRF参数
        const crfIndex = args.indexOf('-crf');
        if (crfIndex !== -1) {
            args.splice(crfIndex, 2); // 移除 -crf 和其值
        }
        
        // 添加CBR码率控制三件套
        args.push('-b:v', `${bitrate}k`);
        args.push('-maxrate', `${Math.round(bitrate * 1.5)}k`); // 最大码率为目标的1.5倍
        args.push('-bufsize', `${Math.round(bitrate * 3)}k`);   // 缓冲区为目标的3倍
        
        if (logCallback) {
            logCallback('info', `📊 CBR模式：目标码率=${bitrate}k, 最大码率=${Math.round(bitrate * 1.5)}k`);
        }
    }

    // === Mac硬件编码器优化的H.264参数 ===
    if (useMacHardwareAccel) {
        // VideoToolbox硬件编码器：使用简化参数集
        args.push('-level', '3.1');       // H.264 Level 3.1 (移动端兼容性)
        // VideoToolbox自动处理GOP和场景切换，无需手动设置
        if (logCallback) {
            logCallback('info', '⚡ VideoToolbox自动优化GOP和场景切换检测');
        }
    } else {
        // 软件编码器：完整H.264优化参数
        args.push('-level', '3.1');           // H.264 Level 3.1 (最佳移动端兼容性)
        args.push('-g', '50');                // GOP大小50 (HLS优化)
        args.push('-sc_threshold', '0');      // 禁用场景切换检测
        if (logCallback) {
            logCallback('info', '🔧 软件编码：完整H.264优化参数');
        }
    }

    // === Mac硬件编码器优化的色彩参数 ===
    if (useMacHardwareAccel) {
        // VideoToolbox硬件编码器：使用简化的色彩参数，减少计算负担
        args.push('-pix_fmt', 'yuv420p');
        if (logCallback) {
            logCallback('info', '🍎 VideoToolbox使用优化色彩参数，提升编码速度');
        }
    } else if (colorEnhancement) {
        // 软件编码器：完整的色彩增强参数
        args.push(
            '-colorspace', 'bt709',       // 色彩空间
            '-color_primaries', 'bt709',  // 色彩基准
            '-color_trc', 'bt709',        // 色彩传输特性
            '-color_range', 'tv',         // 色彩范围（限制范围）
            '-pix_fmt', 'yuv420p'         // 像素格式
        );
        
        // x264高级参数：禁用心理视觉优化，保持原始亮度（仅软件编码）
        args.push('-x264-params', 'aq-mode=0:aq-strength=1.0:deblock=0,0:psy-rd=0.0,0.0:nr=0');
        
        if (logCallback) {
            logCallback('info', '🌈 软件编码：已启用色彩保持增强，防止亮度下降和色彩失真');
        }
    } else {
        // 基础像素格式
        args.push('-pix_fmt', 'yuv420p');
    }

    // 音频编码设置
    args.push('-c:a', 'aac');
    
    if (quality === 'custom') {
        if (customAudioBitrate) {
            args.push('-b:a', `${customAudioBitrate}k`);
        }
        if (customAudioSamplerate) {
            args.push('-ar', customAudioSamplerate.toString());
        }
    } else {
        // === 新增：移动端音频优化 ===
        if (mobileOptimization) {
            args.push('-b:a', '96k');     // 移动端优化的低音频码率
            args.push('-ar', '44100');    // 44.1kHz采样率（CD质量，兼容性最好）
            if (logCallback) {
                logCallback('info', '📱 已启用移动端音频优化：96kbps@44.1kHz');
            }
        } else {
            // 默认音频设置
            args.push('-b:a', '128k');
            args.push('-ar', '48000');
        }
    }

    // === 新增：智能缩放策略处理 ===
    if (resolutionParam) {
        if (scalingStrategy === 'smart-pad') {
            // 智能填充：缩放+填充黑边，保持完整画面
            const [targetWidth, targetHeight] = resolutionParam.split(':');
            args.push('-vf', `scale=${resolutionParam}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2`);
            if (logCallback) {
                logCallback('info', `🎨 智能填充缩放：${resolutionParam}，保持完整画面`);
            }
        } else {
            // 简单缩放：可能裁剪画面
            args.push('-vf', `scale=${resolutionParam}:force_original_aspect_ratio=decrease`);
            if (logCallback) {
                logCallback('info', `📐 简单缩放：${resolutionParam}，可能裁剪画面`);
            }
        }
    }

    // === 新增：HLS移动端兼容性参数 ===
    args.push(
            '-hls_time', segmentDuration.toString(),
            '-hls_list_size', '0',
        '-hls_segment_type', 'mpegts',           // 明确MPEG-TS格式
        '-hls_flags', 'independent_segments',     // 独立片段，更好的播放器兼容性
        '-hls_segment_filename', path.join(outputDir, `${baseName}_%03d.ts`),
            '-f', 'hls',
        path.join(outputDir, `${baseName}.m3u8`)
    );

    if (logCallback) {
        logCallback('info', '📺 HLS兼容性：independent_segments + mpegts格式，支持更多播放器');
    }

        // 获取FFmpeg路径
        const ffmpegExePath = ffmpegPath();
        
        // 构建完整的命令字符串用于日志
        const command = `${ffmpegExePath} ${args.join(' ')}`;
        
        // 打印命令到日志
        if (logCallback) {
            logCallback('command', `🔧 执行命令: ${command}`);
        }

    // 使用新的executeFFmpeg函数执行，支持进度显示和Mac硬件编码回退
    try {
        await executeFFmpeg(args, logCallback, progressCallback, videoInfo.duration);
    } catch (error) {
        // Mac硬件编码失败时，自动回退到软件编码
        if (useMacHardwareAccel && error.message.includes('h264_videotoolbox')) {
            if (logCallback) {
                logCallback('warning', '⚠️ VideoToolbox硬件编码失败，自动回退到软件编码');
            }
            
            // 重新构建使用软件编码的参数
            const fallbackArgs = await buildSoftwareEncodingArgs(inputPath, outputBasePath, options, logCallback);
            await executeFFmpeg(fallbackArgs, logCallback, progressCallback, videoInfo.duration);
        } else {
            // 其他错误直接抛出
            throw error;
        }
    }
}

/**
 * 构建软件编码的回退参数（当Mac硬件编码失败时使用）
 */
async function buildSoftwareEncodingArgs(inputPath, outputBasePath, options, logCallback) {
    const {
        resolution,
        quality,
        segmentDuration,
        customWidth,
        customHeight,
        customProfile,
        customBitrate,
        customFramerate,
        customAudioBitrate,
        customAudioSamplerate,
        customPreset,
        scalingStrategy = 'smart-pad',
        colorEnhancement = true,
        bitrateControlMode = 'crf',
        mobileOptimization = true
    } = options;

    const fileExt = path.extname(inputPath);
    const baseName = path.basename(inputPath, fileExt);
    const outputDir = path.join(outputBasePath, baseName);

    // 软件编码参数（不使用硬件加速）
    const args = ['-i', inputPath];

    // 软件编码器
    args.push('-c:v', 'libx264');

    // 质量设置（使用更快的preset以补偿软件编码的性能损失）
    if (quality === 'custom') {
        if (customProfile) args.push('-profile:v', customProfile);
        if (customBitrate) args.push('-b:v', `${customBitrate}k`);
        if (customFramerate) args.push('-r', customFramerate.toString());
        if (customPreset) args.push('-preset', customPreset);
    } else {
        const qualitySettings = {
            'high': { crf: 20, preset: 'fast', profile: 'baseline' },    // 比原来快一些
            'medium': { crf: 25, preset: 'faster', profile: 'baseline' }, // 比原来快一些  
            'fast': { crf: 28, preset: 'veryfast', profile: 'baseline' }  // 最快设置
        };
        
        const qualitySetting = qualitySettings[quality] || qualitySettings['medium'];
        
        if (qualitySetting.profile) args.push('-profile:v', qualitySetting.profile);
        if (qualitySetting.crf) args.push('-crf', qualitySetting.crf.toString());
        if (qualitySetting.preset) args.push('-preset', qualitySetting.preset);
    }

    // H.264优化参数
    args.push('-level', '3.1', '-g', '50', '-sc_threshold', '0');

    // 色彩参数
    if (colorEnhancement) {
        args.push(
            '-colorspace', 'bt709',
            '-color_primaries', 'bt709',
            '-color_trc', 'bt709',
            '-color_range', 'tv',
            '-pix_fmt', 'yuv420p'
        );
    } else {
        args.push('-pix_fmt', 'yuv420p');
    }

    // 音频编码
    args.push('-c:a', 'aac');
    if (quality === 'custom') {
        if (customAudioBitrate) args.push('-b:a', `${customAudioBitrate}k`);
        if (customAudioSamplerate) args.push('-ar', customAudioSamplerate.toString());
    } else {
        args.push('-b:a', mobileOptimization ? '96k' : '128k');
        args.push('-ar', mobileOptimization ? '44100' : '48000');
    }

    // 分辨率处理
    const resolutionMap = {
        '4k': '3840:2160',
        '2k': '2560:1440', 
        '1080p': '1920:1080',
        '720p': '1280:720',
        '480p': '854:480'
    };

    let resolutionParam;
    if (resolution === 'custom') {
        resolutionParam = `${customWidth}:${customHeight}`;
    } else if (resolution !== 'auto') {
        resolutionParam = resolutionMap[resolution];
    }

    if (resolutionParam) {
        if (scalingStrategy === 'smart-pad') {
            const [targetWidth, targetHeight] = resolutionParam.split(':');
            args.push('-vf', `scale=${resolutionParam}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2`);
        } else {
            args.push('-vf', `scale=${resolutionParam}:force_original_aspect_ratio=decrease`);
        }
    }

    // HLS参数
    args.push(
        '-hls_time', segmentDuration.toString(),
        '-hls_list_size', '0',
        '-hls_segment_type', 'mpegts',
        '-hls_flags', 'independent_segments',
        '-hls_segment_filename', path.join(outputDir, `${baseName}_%03d.ts`),
        '-f', 'hls',
        path.join(outputDir, `${baseName}.m3u8`)
    );

    if (logCallback) {
        logCallback('info', '🔄 使用软件编码回退方案，质量设置已优化以提升速度');
    }

    return args;
}

module.exports = { processVideoFiles }; 