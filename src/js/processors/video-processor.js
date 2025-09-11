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
    // 对于m3u8转换，我们不使用统一的输出目录，而是为每个视频在其同级目录下创建output目录

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

            // 为每个视频文件在其所在目录的同级创建output目录，然后在output下创建以文件名命名的子目录
            const videoDir = path.dirname(file.path);
            const fileName = path.basename(file.path, path.extname(file.path)); // 获取不带扩展名的文件名
            const videoOutputDir = path.join(videoDir, 'output', fileName);
            
            if (logCallback) {
                logCallback('info', `📁 输出目录: ${videoOutputDir}`);
            }
            
            await processVideo(file.path, videoOutputDir, options, logCallback, fileProgressCallback);
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
        const baseNameOriginal = path.basename(inputPath, fileExt);
        // 添加时间戳到文件名以解决浏览器缓存问题
        const now = new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        const baseName = `${baseNameOriginal}_${timestamp}`;

    // 先分析视频获取时长信息
    const videoInfo = await analyzeVideo(inputPath, logCallback);
    
    if (logCallback) {
        logCallback('info', `📹 视频信息: ${videoInfo.width}x${videoInfo.height}, ${formatTime(videoInfo.duration)}, ${videoInfo.fps}fps`);
        logCallback('info', `🎞️ 编码: 视频=${videoInfo.videoCodec}, 音频=${videoInfo.audioCodec}`);
    }

    // 使用传入的输出目录，确保目录存在
    const outputDir = outputBasePath;
    
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
        // macOS: 检查VideoToolbox可用性后使用硬件编码器
        try {
            // 检测系统版本和硬件支持
            const os = require('os');
            const release = os.release();
            const majorVersion = parseInt(release.split('.')[0]);
            
            // macOS 10.13+ (Darwin 17+) 才支持VideoToolbox
            if (majorVersion >= 17) {
                videoEncoder = 'h264_videotoolbox';
                useMacHardwareAccel = true;
                if (logCallback) {
                    logCallback('info', '🚀 VideoToolbox兼容性检查通过，启用硬件编码');
                    logCallback('info', `📱 系统版本: macOS ${majorVersion >= 23 ? '14+' : majorVersion >= 22 ? '13' : majorVersion >= 21 ? '12' : majorVersion >= 20 ? '11' : '10.13+'}`);
                    logCallback('info', '💡 VideoToolbox健康提示：如遇失败会自动回退到软件编码');
                }
            } else {
                if (logCallback) {
                    logCallback('warning', '⚠️ 系统版本过低，VideoToolbox不支持，使用软件编码');
                }
            }
        } catch (error) {
            if (logCallback) {
                logCallback('warning', '⚠️ VideoToolbox兼容性检测失败，使用软件编码');
            }
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
        // === Mac硬件编码器优化的质量设置（稳定兼容版本）===
        if (useMacHardwareAccel) {
            // VideoToolbox硬件编码器：使用保守稳定的参数配置
            const vtQualitySettings = {
                'high': { bitrate: '6000k', maxrate: '8000k', bufsize: '12000k', profile: 'main' },
                'medium': { bitrate: '4000k', maxrate: '6000k', bufsize: '8000k', profile: 'main' },
                'fast': { bitrate: '3000k', maxrate: '4000k', bufsize: '6000k', profile: 'baseline' }
            };
            
            const vtSetting = vtQualitySettings[quality] || vtQualitySettings['medium'];
            args.push('-profile:v', vtSetting.profile);
            
            // VideoToolbox专用参数：稳定优先
            args.push('-allow_sw', '1'); // 允许软件回退
            
            // 根据质量模式选择控制方式（避免参数冲突）
            if (options.complexSceneMode) {
                // 复杂场景：使用码率控制确保稳定
                args.push('-b:v', vtSetting.bitrate);
                args.push('-maxrate', vtSetting.maxrate);
                args.push('-bufsize', vtSetting.bufsize);
                if (logCallback) {
                    logCallback('info', `🎯 VideoToolbox复杂场景稳定模式：码率${vtSetting.bitrate}，确保兼容性`);
                }
            } else {
                // 标准场景：使用质量因子（更好的质量控制）
                const qScale = quality === 'high' ? 20 : quality === 'medium' ? 25 : 30;
                args.push('-q:v', qScale.toString());
                if (logCallback) {
                    logCallback('info', `🎯 VideoToolbox标准质量模式：质量因子${qScale}，优化细节`);
                }
            }
            
            if (logCallback) {
                logCallback('info', `⚡ VideoToolbox稳定模式: profile=${vtSetting.profile}, 兼容性优先`);
            }
        } else {
            // 软件编码器的传统质量设置（极致复杂场景优化）
            const qualitySettings = {
                'high': { crf: 12, preset: 'slower', profile: 'high' },   // 极致质量：CRF 12
                'medium': { crf: 16, preset: 'slow', profile: 'high' },   // 高质量：CRF 16 
                'fast': { crf: 20, preset: 'medium', profile: 'high' }    // 快速高质量：CRF 20
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
            
            // 复杂场景优化参数
            if (options.qualityStability !== false) {
                if (options.complexSceneMode) {
                    // 复杂场景增强模式（使用基础兼容参数）
                    args.push('-threads', '0');        // 自动线程优化
                    args.push('-bf', '3');             // B帧数量优化
                    args.push('-b_strategy', '2');     // B帧策略优化
                    if (logCallback) {
                        logCallback('info', '🎯 软件编码复杂场景优化：基础兼容模式，确保稳定处理');
                    }
                } else {
                    // 标准质量优化（基础兼容参数）
                    args.push('-threads', '0');        // 自动线程优化
                    args.push('-bf', '2');             // 适中B帧数量
                    if (logCallback) {
                        logCallback('info', '🎯 软件编码标准质量优化：基础兼容模式');
                    }
                }
            }
            
            if (logCallback) {
                logCallback('info', `🔧 软件编码高质量: CRF=${qualitySetting.crf}, preset=${qualitySetting.preset}, profile=${qualitySetting.profile}`);
            }
        }
    }

    // === 优化：HLS片段时长计算（需要在关键帧计算前定义）===
    let optimizedSegmentDuration = segmentDuration;
    if (options.fastStartHLS !== false) { // 默认启用快速启动优化
        optimizedSegmentDuration = Math.max(3, Math.min(segmentDuration, 6)); // 限制在3-6秒之间
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
        
        // HLS快速启动优化：关键帧间隔优化
        if (options.fastStartHLS !== false) {
            // 更保守的关键帧间隔，减少马赛克
            const keyframeInterval = Math.min(optimizedSegmentDuration * 30, 150); // 每段多个关键帧
            args.push('-g', keyframeInterval.toString());
            args.push('-keyint_min', Math.floor(keyframeInterval / 3).toString()); // 最小关键帧间隔
            if (logCallback) {
                logCallback('info', `🔑 VideoToolbox稳定关键帧：${keyframeInterval}帧 (最小${Math.floor(keyframeInterval / 3)}帧)`);
            }
        } else {
            if (logCallback) {
                logCallback('info', '⚡ VideoToolbox自动优化GOP和场景切换检测');
            }
        }
    } else {
        // 软件编码器：完整H.264优化参数
        args.push('-level', '3.1');           // H.264 Level 3.1 (最佳移动端兼容性)
        
        if (options.fastStartHLS !== false) {
            // HLS快速启动优化的GOP设置（更稳定的关键帧策略）
            const keyframeInterval = Math.min(optimizedSegmentDuration * 30, 150); // 每段多个关键帧
            args.push('-g', keyframeInterval.toString());
            args.push('-keyint_min', Math.floor(keyframeInterval / 3).toString()); // 最小关键帧间隔
            if (logCallback) {
                logCallback('info', `🔑 软件编码稳定关键帧：${keyframeInterval}帧 (最小${Math.floor(keyframeInterval / 3)}帧)`);
            }
        } else {
            args.push('-g', '50');                // GOP大小50 (HLS优化)
        }
        
        // 复杂场景优化：启用智能场景切换检测
        if (options.qualityStability !== false) {
            args.push('-sc_threshold', '40');    // 启用场景切换检测（阈值40）
            if (logCallback) {
                logCallback('info', '🎬 启用智能场景切换检测，优化复杂画面过渡');
            }
        } else {
            args.push('-sc_threshold', '0');     // 禁用场景切换检测
        }
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

    // === 优化：HLS快速启动参数 ===
    
    args.push(
        '-hls_time', optimizedSegmentDuration.toString(),
        '-hls_list_size', '6',                   // 保持6个片段在播放列表中，便于快速缓冲
        '-hls_segment_type', 'mpegts',           // MPEG-TS格式
        '-hls_flags', 'independent_segments+temp_file', // 独立片段+临时文件避免不完整片段
        '-hls_playlist_type', 'vod',             // VOD类型，优化播放器行为
        '-hls_segment_filename', path.join(outputDir, `${baseName}%03d.ts`),
        '-f', 'hls',
        path.join(outputDir, `${baseName}.m3u8`)
    );

    // 添加快速启动优化（减少MOOV atom延迟）
    if (!useMacHardwareAccel) {
        // 软件编码时可以使用更多优化参数
        args.push('-movflags', '+faststart');   // 快速启动优化
    }

    if (logCallback) {
        logCallback('info', `📺 HLS快速启动优化：${optimizedSegmentDuration}秒片段，6个缓冲片段`);
        if (optimizedSegmentDuration !== segmentDuration) {
            logCallback('info', `⚡ 片段时长已优化：${segmentDuration}s → ${optimizedSegmentDuration}s（提升启动速度）`);
        }
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
        // Mac硬件编码失败时，自动回退到软件编码（增强错误诊断）
        if (useMacHardwareAccel && (error.message.includes('h264_videotoolbox') || 
                                   error.message.includes('VideoToolbox') ||
                                   error.message.includes('Device does not support') ||
                                   error.message.includes('Cannot load') ||
                                   error.message.includes('退出码: 187') ||
                                   error.message.includes('exit code 187'))) {
            if (logCallback) {
                logCallback('warning', '⚠️ VideoToolbox硬件编码失败，自动回退到软件编码');
                logCallback('info', `📋 失败原因: ${error.message.substring(0, 150)}...`);
                
                // 诊断信息
                if (error.message.includes('187')) {
                    logCallback('info', '🔍 错误码187分析：硬件编码器初始化失败，可能原因：');
                    logCallback('info', '   • 系统资源不足或VideoToolbox服务繁忙');
                    logCallback('info', '   • 编码参数组合不兼容');
                    logCallback('info', '   • 其他应用占用硬件编码资源');
                }
                
                logCallback('info', '🔄 正在使用优化的软件编码参数重新处理...');
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
    const baseNameOriginal = path.basename(inputPath, fileExt);
    // 添加时间戳到文件名以解决浏览器缓存问题
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const baseName = `${baseNameOriginal}_${timestamp}`;
    const outputDir = outputBasePath; // 直接使用传入的输出目录

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
        // 回退模式使用与主函数相同的极致质量参数
        const qualitySettings = {
            'high': { crf: 12, preset: 'slower', profile: 'high' },   // 极致质量：CRF 12
            'medium': { crf: 16, preset: 'slow', profile: 'high' },   // 高质量：CRF 16
            'fast': { crf: 20, preset: 'medium', profile: 'high' }    // 快速高质量：CRF 20
        };
        
        const qualitySetting = qualitySettings[quality] || qualitySettings['medium'];
        
        if (qualitySetting.profile) args.push('-profile:v', qualitySetting.profile);
        if (qualitySetting.crf) args.push('-crf', qualitySetting.crf.toString());
        if (qualitySetting.preset) args.push('-preset', qualitySetting.preset);
        
        // 复杂场景优化参数（与主函数保持一致，基础兼容模式）
        if (options.qualityStability !== false) {
            if (options.complexSceneMode) {
                // 复杂场景增强模式（基础兼容参数）
                args.push('-threads', '0');        
                args.push('-bf', '3');             
                args.push('-b_strategy', '2');     
                if (logCallback) {
                    logCallback('info', '🎯 软件编码回退：基础兼容复杂场景优化');
                }
            } else {
                // 标准质量优化（基础兼容参数）
                args.push('-threads', '0');       
                args.push('-bf', '2');             
                if (logCallback) {
                    logCallback('info', '🎯 软件编码回退：基础兼容标准优化');
                }
            }
        }
    }

    // H.264优化参数
    args.push('-level', '3.1');
    
    // HLS快速启动参数计算（需要在关键帧计算前定义）
    let optimizedSegmentDuration = segmentDuration;
    if (options.fastStartHLS !== false) { // 默认启用快速启动优化
        optimizedSegmentDuration = Math.max(3, Math.min(segmentDuration, 6)); // 限制在3-6秒之间
    }
    
    // 关键帧和场景切换优化（与主函数保持一致）
    if (options.fastStartHLS !== false) {
        const keyframeInterval = Math.min(optimizedSegmentDuration * 30, 150);
        args.push('-g', keyframeInterval.toString());
        args.push('-keyint_min', Math.floor(keyframeInterval / 3).toString());
    } else {
        args.push('-g', '50');
    }
    
    // 场景切换检测
    if (options.qualityStability !== false) {
        args.push('-sc_threshold', '40');    // 启用智能场景切换检测
    } else {
        args.push('-sc_threshold', '0');     // 禁用场景切换检测
    }

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

    args.push(
        '-hls_time', optimizedSegmentDuration.toString(),
        '-hls_list_size', '6',                   // 保持6个片段在播放列表中
        '-hls_segment_type', 'mpegts',
        '-hls_flags', 'independent_segments+temp_file',
        '-hls_playlist_type', 'vod',
        '-hls_segment_filename', path.join(outputDir, `${baseName}%03d.ts`),
        '-movflags', '+faststart',               // 软件编码回退时的快速启动
        '-f', 'hls',
        path.join(outputDir, `${baseName}.m3u8`)
    );

    if (logCallback) {
        logCallback('info', '🔄 使用软件编码回退方案，质量设置已优化以提升速度');
    }

    return args;
}

module.exports = { processVideoFiles }; 