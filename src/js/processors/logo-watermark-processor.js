const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { ffmpegPath, ffprobePath, generateUniqueFilename, getHardwareAccelArgs, getFilterCompatibleHwAccelArgs } = require('./common-processor');



/**
 * 运行FFprobe获取视频信息
 */
async function runFfprobe(args) {
    return new Promise((resolve, reject) => {
        const ffprobe = spawn(ffprobePath, args);
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
 * 分析视频文件信息
 */
async function analyzeVideo(filePath, logCallback) {
    try {
        const info = await runFfprobe([
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_streams',
            '-show_format',
            filePath
        ]);
        
        const videoStream = info.streams.find(s => s.codec_type === 'video');
        const audioStream = info.streams.find(s => s.codec_type === 'audio');
        
        if (!videoStream) {
            throw new Error(`文件 ${path.basename(filePath)} 中未找到视频流`);
        }
        
        // 获取视频基本信息
        const width = parseInt(videoStream.width) || 1920;
        const height = parseInt(videoStream.height) || 1080;
        const duration = parseFloat(info.format.duration) || 0;
        const frameRate = videoStream.r_frame_rate ? eval(videoStream.r_frame_rate) : 25;
        const videoBitrate = parseInt(videoStream.bit_rate) || parseInt(info.format.bit_rate) || 2000000;
        
        // 获取编码器信息
        const videoCodec = videoStream.codec_name;
        const audioCodec = audioStream ? audioStream.codec_name : null;
        
        if (logCallback) {
            logCallback('info', `📹 视频信息: ${width}x${height}, ${duration.toFixed(1)}秒, ${frameRate.toFixed(1)}fps`);
            logCallback('info', `🎞️ 编码: 视频=${videoCodec}, 音频=${audioCodec || '无'}`);
        }
        
        return {
            width,
            height,
            duration,
            frameRate,
            videoBitrate,
            videoCodec,
            audioCodec,
            hasAudio: !!audioStream
        };
    } catch (error) {
        if (logCallback) {
            logCallback('error', `分析视频失败: ${error.message}`);
        }
        throw error;
    }
}

/**
 * 构建FFmpeg过滤器字符串
 */
function buildFilterString(options, videoInfo) {
    const filters = [];
    let logoInput = '';
    let watermarkInput = '';
    let inputIndex = 1; // 视频输入是0，图片输入从1开始
    
    // 添加LOGO过滤器
    if (options.addLogo) {
        logoInput = `[${inputIndex}:v]`;
        inputIndex++;
        
        // 计算LOGO的缩放和透明度
        let logoFilter = `${logoInput}scale=${options.logoWidth}:${options.logoHeight}`;
        if (options.logoOpacity < 1) {
            logoFilter += `,format=rgba,colorchannelmixer=aa=${options.logoOpacity}`;
        }
        logoFilter += `[logo]`;
        filters.push(logoFilter);
        
        // 计算LOGO位置和时间
        let overlayFilter = '[0:v][logo]overlay=';
        overlayFilter += `${options.logoX}:${options.logoY}`;
        
        // 添加时间控制
        if (options.logoTimeMode === 'custom') {
            overlayFilter += `:enable='between(t,${options.logoStartTime},${options.logoEndTime})'`;
        }
        
        overlayFilter += '[v1]';
        filters.push(overlayFilter);
    }
    
    // 添加水印过滤器
    if (options.addWatermark) {
        watermarkInput = `[${inputIndex}:v]`;
        
        // 计算水印的缩放和透明度
        let watermarkFilter = `${watermarkInput}scale=${options.watermarkWidth}:${options.watermarkHeight}`;
        if (options.watermarkOpacity < 1) {
            watermarkFilter += `,format=rgba,colorchannelmixer=aa=${options.watermarkOpacity}`;
        }
        watermarkFilter += `[watermark]`;
        filters.push(watermarkFilter);
        
        // 计算水印位置和时间
        const baseInput = options.addLogo ? '[v1]' : '[0:v]';
        let overlayFilter = `${baseInput}[watermark]overlay=`;
        overlayFilter += `${options.watermarkX}:${options.watermarkY}`;
        
        // 添加时间控制
        if (options.watermarkTimeMode === 'custom') {
            overlayFilter += `:enable='between(t,${options.watermarkStartTime},${options.watermarkEndTime})'`;
        }
        
        // 最终输出标签
        overlayFilter += '[vout]';
        filters.push(overlayFilter);
    } else if (options.addLogo) {
        // 如果只有LOGO，重命名为统一的输出标签
        const lastFilter = filters[filters.length - 1];
        filters[filters.length - 1] = lastFilter.replace('[v1]', '[vout]');
    }
    
    return {
        filterString: filters.join(';'),
        outputLabel: (options.addLogo || options.addWatermark) ? '[vout]' : '0:v'
    };
}

/**
 * 获取质量设置
 */
function getQualitySettings(quality) {
    switch (quality) {
        case 'high':
            return { crf: 18, preset: 'slow' };
        case 'medium':
            return { crf: 23, preset: 'medium' };
        case 'fast':
            return { crf: 28, preset: 'fast' };
        case 'source-match':
        default:
            return { crf: 18, preset: 'medium' }; // 高质量保持源视频质量
    }
}

/**
 * 格式化时间显示
 */
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 执行FFmpeg命令（支持精确进度显示）
 */
function executeFFmpeg(args, logCallback, progressCallback = null, totalDuration = null) {
    return new Promise((resolve, reject) => {
        if (!ffmpegPath) {
            return reject(new Error('FFmpeg not found'));
        }

        const ffmpeg = spawn(ffmpegPath, args);
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
                        
                        // 如果进度超过预期总时长，记录警告
                        if (currentTime > totalDuration && logCallback) {
                            logCallback('warn', `⚠️ 处理时间超出预期：${formatTime(currentTime)} > ${formatTime(totalDuration)}`);
                        }
                        
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

/**
 * 处理单个视频文件
 */
async function processVideoLogoWatermark(inputPath, outputPath, options, logCallback, progressCallback = null) {
    try {
        // 分析视频信息
        const videoInfo = await analyzeVideo(inputPath, logCallback);
        
        // 构建FFmpeg参数
        const args = [];
        
        // 添加兼容过滤器的硬件加速参数（避免D3D11格式问题）
        const hwAccelArgs = getFilterCompatibleHwAccelArgs();
        args.push(...hwAccelArgs);
        
        // 输入视频文件
        args.push('-i', inputPath);
        
        // 添加LOGO和水印图片输入
        if (options.addLogo) {
            args.push('-i', options.logoFile);
        }
        if (options.addWatermark) {
            args.push('-i', options.watermarkFile);
        }
        
        // 构建过滤器
        const { filterString, outputLabel } = buildFilterString(options, videoInfo);
        if (filterString) {
            args.push('-filter_complex', filterString);
            // 映射过滤器输出，使用标签名不带方括号
            args.push('-map', outputLabel);
        } else {
            args.push('-map', outputLabel);
        }
        
        // 添加音频映射
        if (videoInfo.hasAudio) {
            args.push('-map', '0:a');
            args.push('-c:a', 'copy'); // 复制音频流，不重新编码
        }
        
        // 获取质量设置
        const qualitySettings = getQualitySettings(options.quality);
        
        // 视频编码设置
        if (options.quality === 'source-match') {
            // 尝试匹配源视频的比特率
            const targetBitrate = Math.round(videoInfo.videoBitrate / 1000); // 转换为kbps
            args.push('-c:v', 'libx264');
            args.push('-b:v', `${targetBitrate}k`);
            args.push('-maxrate', `${Math.round(targetBitrate * 1.2)}k`);
            args.push('-bufsize', `${Math.round(targetBitrate * 2)}k`);
        } else {
            args.push('-c:v', 'libx264');
            args.push('-crf', qualitySettings.crf.toString());
        }
        
        args.push('-preset', qualitySettings.preset);
        args.push('-pix_fmt', 'yuv420p'); // 确保兼容性
        
        // 输出文件
        args.push('-y', outputPath); // -y 覆盖输出文件
        
        if (logCallback) {
            const command = `${ffmpegPath} ${args.join(' ')}`;
            logCallback('command', `🔧 执行命令: ${command}`);
        }
        
        // 使用新的executeFFmpeg函数，支持进度显示
        await executeFFmpeg(args, logCallback, progressCallback, videoInfo.duration);
        
    } catch (error) {
        throw error;
    }
}

/**
 * 处理LOGO水印视频
 */
async function processLogoWatermark(progressCallback, logCallback, outputPath, files, options) {
    // 创建输出目录
    await fs.mkdir(outputPath, { recursive: true });
    
    if (logCallback) {
        logCallback('info', '🏷️ 开始处理视频LOGO水印');
        logCallback('info', `📁 输出目录: ${outputPath}`);
        logCallback('info', `🎯 处理选项: LOGO=${options.addLogo}, 水印=${options.addWatermark}`);
    }
    
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        try {
            // 显示当前文件开始处理的进度
            if (progressCallback) {
                const overallProgress = (i * 100) / files.length;
                progressCallback({
                    current: Math.round(overallProgress),
                    total: 100,
                    status: 'processing',
                    file: `开始处理: ${file.name}`
                });
            }
            
            // 创建单个文件的进度回调包装器
            const fileProgressCallback = progressCallback ? (progress) => {
                // 计算当前文件在整体进度中的权重
                const completedFiles = i;
                const currentFileProgress = (progress.current || 0) / 100;
                
                // 计算整体进度
                const overallProgress = (completedFiles + currentFileProgress) * 100 / files.length;
                
                progressCallback({
                    current: Math.round(overallProgress),
                    total: 100,
                    status: progress.status || 'processing',
                    file: progress.file || `处理中: ${file.name}`,
                    currentTime: progress.currentTime,
                    totalDuration: progress.totalDuration
                });
            } : null;
            
            // 生成输出文件夹和文件名
            const fileExt = path.extname(file.name);
            const baseName = path.basename(file.name, fileExt);
            
            // 为每个文件创建独立的子文件夹
            const fileOutputDir = path.join(outputPath, `LOGO水印处理_${baseName}`);
            await fs.mkdir(fileOutputDir, { recursive: true });
            
            // 使用原文件名作为输出文件名
            const outputFilePath = path.join(fileOutputDir, file.name);
            
            if (logCallback) {
                logCallback('info', `🎥 处理文件: ${file.name}`);
                logCallback('info', `📁 输出目录: ${path.basename(fileOutputDir)}`);
            }
            
            // 处理单个视频，传递进度回调
            await processVideoLogoWatermark(file.path, outputFilePath, options, logCallback, fileProgressCallback);
            
            successCount++;
            
            if (logCallback) {
                logCallback('success', `✅ ${file.name} 处理完成`);
            }
            
        } catch (error) {
            errorCount++;
            if (logCallback) {
                logCallback('error', `❌ ${file.name} 处理失败: ${error.message}`);
            }
        }
    }
    
    if (progressCallback) {
        progressCallback({
            current: 100,
            total: 100,
            status: 'complete',
            file: `处理完成: 成功 ${successCount}, 失败 ${errorCount}`
        });
    }
    
    if (logCallback) {
        logCallback('success', `🎉 LOGO水印处理完成: 成功 ${successCount}, 失败 ${errorCount}`);
    }
}

module.exports = {
    processLogoWatermark
};