const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { ffmpegPath, ffprobePath, generateUniqueFilename, getHardwareAccelArgs, getFilterCompatibleHwAccelArgs, getBestHardwareEncoder, getAccelerationType } = require('./common-processor');

// 分析视频文件的编码信息
async function analyzeVideosForComposition(files, logCallback) {
    const videoInfos = [];
    
    if (logCallback) {
        logCallback('info', '🔍 开始分析视频编码信息...');
    }
    
    for (const file of files) {
        try {
            const info = await runFfprobe([
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_streams',
                '-show_format',
                file.path
            ]);
            
            const videoStream = info.streams.find(s => s.codec_type === 'video');
            const audioStream = info.streams.find(s => s.codec_type === 'audio');
            
            if (!videoStream) {
                throw new Error(`文件 ${file.name} 中未找到视频流`);
            }
            
            // 计算帧率
            let frameRate = 25; // 默认值
            if (videoStream.r_frame_rate) {
                const [num, den] = videoStream.r_frame_rate.split('/');
                if (den && parseInt(den) !== 0) {
                    frameRate = parseInt(num) / parseInt(den);
                }
            }
            
            videoInfos.push({
                file: file.path,
                fileName: file.name,
                videoCodec: videoStream.codec_name,
                audioCodec: audioStream?.codec_name || null,
                frameRate: frameRate,
                width: videoStream.width,
                height: videoStream.height,
                pixelFormat: videoStream.pix_fmt,
                duration: parseFloat(info.format.duration || 0)
            });
            
            if (logCallback) {
                logCallback('info', `📊 ${file.name}: ${videoStream.codec_name}编码, ${videoStream.width}x${videoStream.height}, ${frameRate.toFixed(2)}fps`);
            }
            
        } catch (error) {
            throw new Error(`分析视频文件 ${file.name} 失败: ${error.message}`);
        }
    }
    
    return videoInfos;
}

// 使用ffprobe获取视频信息
function runFfprobe(args) {
    return new Promise((resolve, reject) => {
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
                try {
                    resolve(JSON.parse(output));
                } catch (e) {
                    reject(new Error(`Failed to parse ffprobe output: ${e.message}`));
                }
            } else {
                reject(new Error(`ffprobe exited with code ${code}: ${errorOutput}`));
            }
        });

        ffprobe.on('error', (err) => reject(err));
    });
}

// 编码器兼容性映射
function getCodecCompatibilityGroup(codec) {
    const compatibilityGroups = {
        // H.264 兼容组
        'h264': 'h264_group',
        'libx264': 'h264_group',
        'x264': 'h264_group',
        
        // H.265 兼容组  
        'h265': 'h265_group',
        'hevc': 'h265_group',
        'libx265': 'h265_group',
        
        // AAC 兼容组
        'aac': 'aac_group',
        'libfdk_aac': 'aac_group',
        'aac_at': 'aac_group',
        
        // MP3 兼容组
        'mp3': 'mp3_group',
        'libmp3lame': 'mp3_group',
        'mp3float': 'mp3_group',
        
        // WMV 兼容组
        'wmv1': 'wmv_group',
        'wmv2': 'wmv_group',
        'wmv3': 'wmv_group',
        
        // WMA 兼容组
        'wmav1': 'wma_group',
        'wmav2': 'wma_group'
    };
    
    return compatibilityGroups[codec?.toLowerCase()] || codec?.toLowerCase();
}

// 检查编码器是否兼容
function areCodecsCompatible(sourceCodecs, targetCodec) {
    if (!sourceCodecs || sourceCodecs.length === 0) return true;
    
    const targetGroup = getCodecCompatibilityGroup(targetCodec);
    const sourceGroups = sourceCodecs.map(codec => getCodecCompatibilityGroup(codec));
    
    // 如果所有源编码器都与目标编码器兼容，则不需要转换
    return sourceGroups.every(group => group === targetGroup);
}

// 判断是否需要预处理
function needsPreprocessing(videoInfos, targetFormat, targetResolution, logCallback) {
    if (videoInfos.length === 0) {
        return { needsPreprocessing: false, analysis: {} };
    }
    
    // 以第一个视频为基准
    const referenceVideo = videoInfos[0];
    const referenceCodec = getCodecCompatibilityGroup(referenceVideo.videoCodec);
    const referenceAudioCodec = getCodecCompatibilityGroup(referenceVideo.audioCodec);
    const referenceFrameRate = Math.round(referenceVideo.frameRate * 100) / 100;
    const referenceResolution = `${referenceVideo.width}x${referenceVideo.height}`;
    const referencePixelFormat = referenceVideo.pixelFormat;
    
    // 分析哪些视频需要预处理
    const videosNeedingPreprocessing = [];
    const videoCodecs = [];
    const audioCodecs = [];
    const frameRates = [];
    const resolutions = [];
    const pixelFormats = [];
    
    for (let i = 0; i < videoInfos.length; i++) {
        const video = videoInfos[i];
        const videoCodec = getCodecCompatibilityGroup(video.videoCodec);
        const audioCodec = getCodecCompatibilityGroup(video.audioCodec);
        const frameRate = Math.round(video.frameRate * 100) / 100;
        const resolution = `${video.width}x${video.height}`;
        const pixelFormat = video.pixelFormat;
        
        videoCodecs.push(video.videoCodec);
        audioCodecs.push(video.audioCodec);
        frameRates.push(frameRate);
        resolutions.push(resolution);
        pixelFormats.push(pixelFormat);
        
        // 检查是否与基准视频不同
        const needsPreprocessing = 
            videoCodec !== referenceCodec ||
            audioCodec !== referenceAudioCodec ||
            frameRate !== referenceFrameRate ||
            resolution !== referenceResolution ||
            pixelFormat !== referencePixelFormat;
            
        if (needsPreprocessing) {
            videosNeedingPreprocessing.push({
                index: i,
                fileName: video.fileName,
                reasons: {
                    videoCodec: videoCodec !== referenceCodec,
                    audioCodec: audioCodec !== referenceAudioCodec,
                    frameRate: frameRate !== referenceFrameRate,
                    resolution: resolution !== referenceResolution,
                    pixelFormat: pixelFormat !== referencePixelFormat
                }
            });
        }
    }
    
    const analysis = {
        referenceVideo: {
            fileName: referenceVideo.fileName,
            videoCodec: referenceVideo.videoCodec,
            audioCodec: referenceVideo.audioCodec,
            frameRate: referenceFrameRate,
            resolution: referenceResolution,
            pixelFormat: referencePixelFormat
        },
        videosNeedingPreprocessing,
        allVideoCodecs: [...new Set(videoCodecs)],
        allAudioCodecs: [...new Set(audioCodecs.filter(Boolean))],
        allFrameRates: [...new Set(frameRates)],
        allResolutions: [...new Set(resolutions)],
        allPixelFormats: [...new Set(pixelFormats)]
    };
    
    const needsPreprocessing = analysis.needsVideoUnification || 
                              analysis.needsAudioUnification || 
                              analysis.needsFrameRateUnification || 
                              analysis.needsResolutionUnification ||
                              analysis.needsPixelFormatUnification;
    
    let needsPreprocessingFlag = videosNeedingPreprocessing.length > 0;
    let useQuickTSConversion = false;
    
    // 智能判断：如果有多个视频文件且格式相同，优先使用快速TS转换
    if (!needsPreprocessingFlag && videoInfos.length > 1) {
        // 检查是否适合TS转换（格式相同且都是H.264）
        const allH264 = videoInfos.every(video => 
            video.videoCodec.toLowerCase().includes('h264') || 
            video.videoCodec.toLowerCase() === 'avc1'
        );
        
        if (allH264) {
            useQuickTSConversion = true;
            if (logCallback) {
                logCallback('info', `⚡ 检测到相同H.264格式视频，将使用快速TS转换方法（无损、速度快）`);
            }
        } else {
            // 非H.264或格式不统一，使用重编码预处理
            needsPreprocessingFlag = true;
            for (let i = 0; i < videoInfos.length; i++) {
                videosNeedingPreprocessing.push({
                    index: i,
                    fileName: videoInfos[i].fileName,
                    reasons: {
                        videoCodec: false,
                        audioCodec: false,
                        frameRate: false,
                        resolution: false,
                        pixelFormat: false,
                        forceStandardization: true
                    }
                });
            }
        }
    }
    
    if (logCallback) {
        logCallback('info', `🎯 以第一个视频为基准: ${referenceVideo.fileName}`);
        logCallback('info', `📊 基准格式: ${referenceVideo.videoCodec}/${referenceVideo.audioCodec}, ${referenceResolution}, ${referenceFrameRate}fps`);
        
        if (needsPreprocessingFlag) {
            if (videosNeedingPreprocessing.some(v => v.reasons.forceStandardization)) {
                logCallback('info', `🔄 多个视频文件，为确保concat兼容性，将对所有 ${videosNeedingPreprocessing.length} 个视频进行标准化预处理`);
            } else {
                logCallback('info', `⚠️  检测到 ${videosNeedingPreprocessing.length} 个视频需要预处理以匹配基准格式:`);
            }
            
            videosNeedingPreprocessing.forEach(video => {
                if (video.reasons.forceStandardization) {
                    logCallback('info', `   - ${video.fileName}: 标准化处理`);
                } else {
                    const reasons = [];
                    if (video.reasons.videoCodec) reasons.push('视频编码');
                    if (video.reasons.audioCodec) reasons.push('音频编码');
                    if (video.reasons.frameRate) reasons.push('帧率');
                    if (video.reasons.resolution) reasons.push('分辨率');
                    if (video.reasons.pixelFormat) reasons.push('像素格式');
                    
                    logCallback('info', `   - ${video.fileName}: ${reasons.join(', ')}`);
                }
            });
        } else {
            logCallback('info', '✅ 单个视频文件，无需预处理');
        }
    }
    
    // 更新分析结果以包含所有需要预处理的视频
    analysis.videosNeedingPreprocessing = videosNeedingPreprocessing;
    
    return { 
        needsPreprocessing: needsPreprocessingFlag, 
        useQuickTSConversion: useQuickTSConversion,
        analysis 
    };
}

// 快速TS转换方法 - 无损流拷贝，速度快
async function convertToTSFormat(videoInfos, outputDir, progressCallback, logCallback) {
    const tsFiles = [];
    const tempDir = path.join(outputDir, 'temp_ts');
    await fs.mkdir(tempDir, { recursive: true });
    
    if (logCallback) {
        logCallback('info', `⚡ 开始TS转换 ${videoInfos.length} 个视频文件（无损快速模式）...`);
    }
    
    for (let i = 0; i < videoInfos.length; i++) {
        const video = videoInfos[i];
        const tsFileName = `${i + 1}_${path.basename(video.fileName, path.extname(video.fileName))}.ts`;
        const tsPath = path.join(tempDir, tsFileName);
        
        if (progressCallback) {
            progressCallback({ 
                current: i, 
                total: videoInfos.length, 
                status: 'converting', 
                file: `TS转换: ${video.fileName}` 
            });
        }
        
        // TS转换参数：流拷贝 + h264_mp4toannexb
        const args = [
            '-i', video.file,
            '-c', 'copy',  // 流拷贝，无损
            '-bsf:v', 'h264_mp4toannexb',  // 关键：转换NAL格式
            '-y', // 覆盖输出文件
            tsPath
        ];
        
        try {
            if (logCallback) {
                logCallback('info', `🔄 转换 ${video.fileName} → ${tsFileName}`);
            }
            
            await executeFFmpeg(args, logCallback);
            
            tsFiles.push({
                name: tsFileName,
                path: tsPath,
                original: video.fileName,
                isTS: true
            });
            
            if (logCallback) {
                logCallback('success', `✅ ${video.fileName} TS转换完成`);
            }
        } catch (error) {
            throw new Error(`TS转换失败 ${video.fileName}: ${error.message}`);
        }
    }
    
    if (progressCallback) {
        progressCallback({ 
            current: videoInfos.length, 
            total: videoInfos.length, 
            status: 'complete', 
            file: '所有视频TS转换完成' 
        });
    }
    
    if (logCallback) {
        logCallback('success', `🎯 所有视频TS转换完成，开始合成...`);
    }
    
    return { tsFiles, tempDir };
}

// 预处理视频文件 - 以第一个视频为基准
async function preprocessVideos(videoInfos, analysisResult, outputDir, progressCallback, logCallback) {
    const preprocessedFiles = [];
    const tempDir = path.join(outputDir, 'temp_preprocessed');
    await fs.mkdir(tempDir, { recursive: true });
    
    const referenceVideo = analysisResult.referenceVideo;
    const videosToPreprocess = analysisResult.videosNeedingPreprocessing;
    
    if (logCallback) {
        logCallback('info', `🔄 开始预处理 ${videosToPreprocess.length} 个视频文件...`);
        logCallback('info', `🎯 目标格式(基准): ${referenceVideo.videoCodec}/${referenceVideo.audioCodec}, ${referenceVideo.resolution}, ${referenceVideo.frameRate}fps`);
    }
    
    // 首先添加基准视频（不需要预处理）
    for (let i = 0; i < videoInfos.length; i++) {
        const videoInfo = videoInfos[i];
        const needsPreprocessing = videosToPreprocess.find(v => v.index === i);
        
        if (!needsPreprocessing) {
            // 不需要预处理的视频，直接使用原文件
            preprocessedFiles.push({
                name: videoInfo.fileName,
                path: videoInfo.file,
                original: videoInfo.fileName,
                isOriginal: true
            });
            continue;
        }
        
        // 需要预处理的视频
        const outputFileName = `preprocessed_${i + 1}_${path.basename(videoInfo.fileName, path.extname(videoInfo.fileName))}.mp4`;
        const outputPath = path.join(tempDir, outputFileName);
        
        if (progressCallback) {
            progressCallback({ 
                current: videosToPreprocess.indexOf(needsPreprocessing), 
                total: videosToPreprocess.length, 
                status: 'preprocessing', 
                file: `预处理: ${videoInfo.fileName}` 
            });
        }
        
        // 使用基准视频的格式参数
        const [refWidth, refHeight] = referenceVideo.resolution.split('x').map(Number);
        const args = [
            '-i', videoInfo.file,
            '-c:v', referenceVideo.videoCodec === 'h264' ? 'libx264' : referenceVideo.videoCodec,
            '-pix_fmt', referenceVideo.pixelFormat,
            '-vf', `scale=${refWidth}:${refHeight}:force_original_aspect_ratio=decrease,pad=${refWidth}:${refHeight}:(ow-iw)/2:(oh-ih)/2:black`,
            '-r', referenceVideo.frameRate.toString(),
            '-y' // 覆盖输出文件
        ];
        
        // 处理音频：使用基准视频的音频编码
        if (videoInfo.audioCodec && referenceVideo.audioCodec) {
            const audioCodec = referenceVideo.audioCodec === 'aac' ? 'aac' : referenceVideo.audioCodec;
            args.push('-c:a', audioCodec);
        } else if (!videoInfo.audioCodec || !referenceVideo.audioCodec) {
            args.push('-an'); // 移除音频
        }
        
        args.push(outputPath);
        
        try {
            // 创建预处理进度回调
            const preprocessProgressCallback = (progress) => {
                if (progressCallback) {
                    progressCallback({
                        current: videosToPreprocess.indexOf(needsPreprocessing),
                        total: videosToPreprocess.length,
                        status: 'preprocessing',
                        file: `预处理: ${videoInfo.fileName} - ${progress.file || ''}`
                    });
                }
            };
            
            await executeFFmpeg(args, logCallback, preprocessProgressCallback, videoInfo.duration);
            preprocessedFiles.push({
                name: outputFileName,
                path: outputPath,
                original: videoInfo.fileName,
                isOriginal: false
            });
            
            if (logCallback) {
                logCallback('success', `✅ ${videoInfo.fileName} 预处理完成 → 匹配基准格式`);
            }
        } catch (error) {
            throw new Error(`预处理视频 ${videoInfo.fileName} 失败: ${error.message}`);
        }
    }
    
    return { preprocessedFiles, tempDir };
}

// 找到最优的帧率
function findOptimalFrameRate(frameRates) {
    // 常见的标准帧率
    const standardRates = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
    
    // 如果所有帧率相同，直接返回
    if (new Set(frameRates).size === 1) {
        return frameRates[0];
    }
    
    // 找到最接近的标准帧率
    const avgFrameRate = frameRates.reduce((sum, rate) => sum + rate, 0) / frameRates.length;
    const closestStandard = standardRates.reduce((prev, curr) => 
        Math.abs(curr - avgFrameRate) < Math.abs(prev - avgFrameRate) ? curr : prev
    );
    
    return closestStandard;
}

async function composeVideos(progressCallback, logCallback, outputPath, files, options) {
    const { composeType, format } = options;
    
    // 生成智能文件夹名
    let folderName;
    if (files.length === 1) {
        const baseName = path.basename(files[0].name, path.extname(files[0].name));
        folderName = `合成视频_${baseName}`;
    } else {
        folderName = `合成视频_多文件合成`;
    }
    
    const outputDir = path.join(outputPath, folderName);
    await fs.mkdir(outputDir, { recursive: true });

    let tempDir = null;
    let actualFiles = files; // 用于合成的实际文件（原文件或预处理后的文件）
    
    try {
        // 生成输出文件名，根据格式添加正确的扩展名
        let outputFileName;
        if (files.length === 1) {
            // 单个文件直接使用原名称
            const baseName = path.basename(files[0].name, path.extname(files[0].name));
            outputFileName = `${baseName}.${format}`;
        } else {
            // 多个文件使用通用名称
            outputFileName = `合成视频.${format}`;
        }
        
        const finalOutputPath = path.join(outputDir, outputFileName);
        
        if (logCallback) {
            logCallback('info', `🎬 开始合成视频，类型: ${getComposeTypeName(composeType)}`);
            logCallback('info', `📁 输出文件: ${finalOutputPath}`);
            logCallback('info', `🎞️ 输出格式: ${format.toUpperCase()}`);
        }
        
        progressCallback({ current: 0, total: 1, status: 'analyzing', file: '正在分析视频信息...' });
        
        // 步骤1: 分析视频编码信息
        const videoInfos = await analyzeVideosForComposition(files, logCallback);
        
        // 获取质量设置和格式配置
        const qualitySettings = getQualitySettings(options.quality);
        const formatSettings = getFormatSettings(format);
        const resolvedResolution = await resolveResolution(files, options.resolution);
        
        // 步骤2: 判断是否需要预处理
        const { needsPreprocessing: needsPreprocessingFlag, useQuickTSConversion, analysis } = needsPreprocessing(videoInfos, format, resolvedResolution, logCallback);
        
        // 步骤3: 智能选择预处理方式
        if (useQuickTSConversion) {
            // 使用快速TS转换（推荐方式）
            progressCallback({ current: 0, total: 1, status: 'converting', file: '正在进行TS转换...' });
            
            const { tsFiles, tempDir: tempDirPath } = await convertToTSFormat(
                videoInfos, 
                outputDir, 
                progressCallback, 
                logCallback
            );
            
            tempDir = tempDirPath;
            actualFiles = tsFiles; // 使用TS转换后的文件
            
        } else if (needsPreprocessingFlag) {
            // 使用完整重编码预处理（兼容性处理）
            progressCallback({ current: 0, total: 1, status: 'preprocessing', file: '正在预处理视频...' });
            
            const { preprocessedFiles, tempDir: tempDirPath } = await preprocessVideos(
                videoInfos, 
                analysis, 
                outputDir, 
                progressCallback, 
                logCallback
            );
            
            tempDir = tempDirPath;
            actualFiles = preprocessedFiles; // 使用预处理后的文件
            
            if (logCallback) {
                logCallback('success', `🎯 所有视频预处理完成，开始合成...`);
            }
        }
        
        progressCallback({ current: 0, total: 1, status: 'composing', file: '正在合成视频...' });
        
        // 步骤4: 构建FFmpeg参数并执行合成
        const finalOutputFileName = path.basename(finalOutputPath);
        let ffmpegArgs;
        switch (composeType) {
            case 'concat':
                ffmpegArgs = await buildConcatArgs(actualFiles, outputDir, finalOutputFileName, options, qualitySettings, resolvedResolution, formatSettings);
                break;
            case 'sidebyside':
                ffmpegArgs = await buildSideBySideArgs(actualFiles, outputDir, finalOutputFileName, options, qualitySettings, resolvedResolution, formatSettings);
                break;
            case 'pip':
                ffmpegArgs = await buildPipArgs(actualFiles, outputDir, finalOutputFileName, options, qualitySettings, resolvedResolution, formatSettings);
                break;
            default:
                throw new Error(`不支持的合成类型: ${composeType}`);
        }
        
        // 计算合成的总时长
        let totalDuration = 0;
        if (composeType === 'concat') {
            // 连接模式：所有视频时长的总和
            totalDuration = videoInfos.reduce((sum, video) => sum + video.duration, 0);
        } else {
            // 并排或画中画模式：取最长视频的时长
            totalDuration = Math.max(...videoInfos.map(video => video.duration));
        }
        
        // 调试日志：显示计算的总时长
        if (logCallback) {
            logCallback('info', `⏱️ 预计处理时长: ${formatTime(totalDuration)} (${totalDuration.toFixed(2)}秒)`);
            videoInfos.forEach((video, index) => {
                logCallback('info', `📝 视频${index + 1}: ${video.fileName} - ${formatTime(video.duration)} (${video.duration.toFixed(2)}秒)`);
            });
        }
        
        // 创建合成进度回调
        const composeProgressCallback = (progress) => {
            if (progressCallback) {
                progressCallback({
                    current: progress.current || 0,
                    total: progress.total || 100,
                    status: 'processing',
                    file: progress.file || '正在合成视频...'
                });
            }
        };
        
        await executeFFmpeg(ffmpegArgs, logCallback, composeProgressCallback, totalDuration);
        
        // 步骤5: 清理临时文件
        if (tempDir) {
            try {
                await fs.rmdir(tempDir, { recursive: true });
        if (logCallback) {
                    logCallback('info', '🧹 临时文件清理完成');
                }
            } catch (cleanupError) {
                if (logCallback) {
                    logCallback('warn', `⚠️  临时文件清理失败: ${cleanupError.message}`);
                }
            }
        }
        
        progressCallback({ current: 1, total: 1, status: 'complete', file: finalOutputFileName });
        
        if (logCallback) {
            logCallback('success', `✅ 视频合成完成: ${finalOutputFileName}`);
        }
        
        return { processed: 1, failed: 0 };
        
    } catch (error) {
        // 错误时也要清理临时文件
        if (tempDir) {
            try {
                await fs.rmdir(tempDir, { recursive: true });
            } catch (cleanupError) {
                // 忽略清理错误
            }
        }
        
        if (logCallback) {
            logCallback('error', `❌ 视频合成失败: ${error.message}`);
        }
        return { processed: 0, failed: 1 };
    }
}

// 质量预设配置
function getQualitySettings(qualityOption) {
    // 如果是自定义质量设置
    if (typeof qualityOption === 'object' && qualityOption.preset === 'custom') {
        return {
            isCustom: true,
            videoProfile: qualityOption.videoProfile,
            videoBitrate: qualityOption.videoBitrate,
            videoFramerate: qualityOption.videoFramerate,
            audioBitrate: qualityOption.audioBitrate,
            audioSamplerate: qualityOption.audioSamplerate,
            preset: qualityOption.encodePreset
        };
    }
    
    // 预设质量配置（默认使用baseline profile以获得最佳兼容性）
    const preset = qualityOption.preset || qualityOption;
    const qualityMap = {
        'high': { crf: 18, preset: 'slower', audioBitrate: '192k', videoProfile: 'baseline' },
        'medium': { crf: 23, preset: 'medium', audioBitrate: '128k', videoProfile: 'baseline' },
        'fast': { crf: 28, preset: 'fast', audioBitrate: '96k', videoProfile: 'baseline' }
    };
    return { isCustom: false, ...qualityMap[preset] || qualityMap['medium'] };
}

// 格式设置配置
function getFormatSettings(format) {
    const formatMap = {
        'mp4': {
            videoCodec: 'libx264',
            audioCodec: 'aac',
            container: 'mp4',
            pixelFormat: 'yuv420p'
        },
        'avi': {
            videoCodec: 'libx264',
            audioCodec: 'mp3',
            container: 'avi',
            pixelFormat: 'yuv420p'
        },
        'mkv': {
            videoCodec: 'libx264',
            audioCodec: 'aac',
            container: 'matroska',
            pixelFormat: 'yuv420p'
        },
        'wmv': {
            videoCodec: 'wmv2',
            audioCodec: 'wmav2',
            container: 'asf',
            pixelFormat: 'yuv420p'
        },
        'mov': {
            videoCodec: 'libx264',
            audioCodec: 'aac',
            container: 'mov',
            pixelFormat: 'yuv420p'
        }
    };
    return formatMap[format] || formatMap['mp4'];
}

// 解析分辨率设置
async function resolveResolution(files, resolutionSetting) {
    // 如果是自定义分辨率对象
    if (typeof resolutionSetting === 'object' && resolutionSetting.type === 'custom') {
        return { 
            width: resolutionSetting.width, 
            height: resolutionSetting.height, 
            label: `${resolutionSetting.width}x${resolutionSetting.height}` 
        };
    }
    
    if (resolutionSetting === 'auto') {
        // TODO: 可以在这里分析视频文件获取最佳分辨率
        return { width: 1920, height: 1080, label: '1080p (auto)' };
    }
    
    const resolutionMap = {
        '4k': { width: 3840, height: 2160, label: '4K' },
        '2k': { width: 2560, height: 1440, label: '2K' },
        '1080p': { width: 1920, height: 1080, label: '1080p' },
        '720p': { width: 1280, height: 720, label: '720p' },
        '480p': { width: 854, height: 480, label: '480p' }
    };
    
    return resolutionMap[resolutionSetting] || resolutionMap['720p'];
}

async function buildConcatArgs(files, outputDir, outputFileName, options, qualitySettings, resolution, formatSettings) {
    const { transition, audioMode, aspectRatio, background } = options;
    
    // ✅ 使用filter_complex方式，完全参考intro-outro-processor.js
    const args = [];
    
    // 添加兼容过滤器的硬件加速支持（避免D3D11格式问题）
    args.push(...getFilterCompatibleHwAccelArgs());
    
    const inputFiles = [];
    let videoProcessing = '';  // 视频流处理部分
    let concatInputs = '';     // concat输入部分
    let inputIndex = 0;
    
    // 构建输入文件列表和filter
    for (const file of files) {
        args.push('-i', file.path);
        inputFiles.push(file.path);
        
        // 标准化视频流处理 (setsar=1/1,setdar=16/9)
        videoProcessing += `[${inputIndex}:v]setsar=1/1,setdar=16/9[v${inputIndex}];`;
        concatInputs += `[v${inputIndex}][${inputIndex}:a]`;
        inputIndex++;
    }
    
    // 构建完整的filter_complex命令
    const filterComplex = `${videoProcessing}${concatInputs}concat=n=${inputIndex}:v=1:a=1[v][a]`;
    
    args.push('-filter_complex', filterComplex);
    args.push('-map', '[v]', '-map', '[a]');
    
    // ✅ 编码参数处理 (参考intro-outro-processor.js的质量设置逻辑)
    if (qualitySettings.isCustom) {
        // 自定义质量参数
        args.push('-c:v', formatSettings.videoCodec);
        args.push('-c:a', formatSettings.audioCodec);
        args.push('-pix_fmt', formatSettings.pixelFormat);
        
        if (formatSettings.videoCodec === 'libx264') {
            args.push('-profile:v', qualitySettings.videoProfile);
            args.push('-b:v', `${qualitySettings.videoBitrate}k`);
            args.push('-r', qualitySettings.videoFramerate.toString());
            args.push('-preset', qualitySettings.preset);
        } else if (formatSettings.videoCodec === 'wmv2') {
            args.push('-b:v', `${qualitySettings.videoBitrate}k`);
        }
        
        // 自定义音频参数
        if (formatSettings.audioCodec === 'aac' || formatSettings.audioCodec === 'mp3') {
            args.push('-b:a', `${qualitySettings.audioBitrate}k`);
            args.push('-ar', qualitySettings.audioSamplerate.toString());
        } else if (formatSettings.audioCodec === 'wmav2') {
            args.push('-b:a', `${qualitySettings.audioBitrate}k`);
        }
    } else {
        // ✅ 预设质量参数 - filter_complex模式需要重编码
        if (qualitySettings.preset === 'copy') {
            // filter_complex模式不能使用-c copy，使用快速硬件编码
            const encoder = getBestHardwareEncoder('h264', console.log);
            args.push('-c:v', encoder);
            
            if (process.platform === 'darwin') {
                args.push('-profile:v', 'baseline', '-b:v', '8000k', '-preset', 'faster');
            } else {
                args.push('-preset', 'faster', '-crf', '18');
            }
            
            args.push('-c:a', 'aac', '-b:a', '128k');
        } else {
            // 其他质量预设
            args.push('-c:v', formatSettings.videoCodec);
            args.push('-c:a', formatSettings.audioCodec);
            args.push('-pix_fmt', formatSettings.pixelFormat);
            
        if (formatSettings.videoCodec === 'libx264') {
            args.push('-crf', qualitySettings.crf.toString());
            args.push('-preset', qualitySettings.preset);
                // 添加默认profile设置
                if (qualitySettings.videoProfile) {
                    args.push('-profile:v', qualitySettings.videoProfile);
                }
        } else if (formatSettings.videoCodec === 'wmv2') {
            const bitrateMap = { high: '5000k', medium: '2000k', fast: '1000k' };
            args.push('-b:v', bitrateMap[qualitySettings.preset] || '2000k');
        }
        
        // 预设音频比特率
        if (formatSettings.audioCodec === 'aac' || formatSettings.audioCodec === 'mp3') {
            args.push('-b:a', qualitySettings.audioBitrate);
        } else if (formatSettings.audioCodec === 'wmav2') {
            args.push('-b:a', '128k');
        }
    }
    }
    
    // ✅ 音频处理
    if (audioMode === 'mute') {
        args.push('-an'); // 移除音频
    } else if (audioMode === 'normalize' && formatSettings.audioCodec !== 'wmav2') {
        args.push('-af', 'loudnorm');
    }
    
    // 容器格式
    if (formatSettings.container !== 'auto') {
        args.push('-f', formatSettings.container);
    }
    
    args.push('-y', path.join(outputDir, outputFileName));
    
    // ✅ 添加调试日志
    console.log(`🎬 Filter命令: ${filterComplex}`);
    console.log(`📋 输入文件数量: ${inputIndex}`);
    console.log(`🚀 使用filter_complex模式，采用${getAccelerationType()}加速，避免音画同步问题`);
    
    return args;
}

function buildVideoFilter(resolution, aspectRatio, background) {
    const { width, height } = resolution;
    let filters = [];
    
    switch (aspectRatio) {
        case 'pad':
            filters.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease`);
            filters.push(`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:${getBackgroundColor(background)}`);
            break;
        case 'crop':
            filters.push(`scale=${width}:${height}:force_original_aspect_ratio=increase`);
            filters.push(`crop=${width}:${height}`);
            break;
        case 'stretch':
            filters.push(`scale=${width}:${height}`);
            break;
        default:
            filters.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease`);
            filters.push(`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`);
    }
    
    return filters.join(',');
}

function getBackgroundColor(background) {
    const colorMap = {
        'black': 'black',
        'white': 'white',
        'blur': 'black' // 暂时用黑色，模糊背景需要更复杂的实现
    };
    return colorMap[background] || 'black';
}

async function buildSideBySideArgs(files, outputDir, outputFileName, options, qualitySettings, resolution, formatSettings) {
    if (files.length !== 2) {
        throw new Error('并排显示模式需要选择恰好2个视频文件');
    }
    
    const { audioMode, background } = options;
    const { width, height } = resolution;
    const halfWidth = Math.floor(width / 2);
    const backgroundColor = getBackgroundColor(background);
    
    const filterComplex = 
        `[0:v]scale=${halfWidth}:${height}:force_original_aspect_ratio=decrease,pad=${halfWidth}:${height}:(ow-iw)/2:(oh-ih)/2:${backgroundColor}[left];` +
        `[1:v]scale=${halfWidth}:${height}:force_original_aspect_ratio=decrease,pad=${halfWidth}:${height}:(ow-iw)/2:(oh-ih)/2:${backgroundColor}[right];` +
        `[left][right]hstack=inputs=2[v]`;
    
    const args = [
        '-i', files[0].path,
        '-i', files[1].path,
        '-filter_complex', filterComplex,
        '-map', '[v]',
        '-c:v', formatSettings.videoCodec,
        '-c:a', formatSettings.audioCodec,
        '-pix_fmt', formatSettings.pixelFormat
    ];
    
    // 根据质量设置添加编码参数
    if (qualitySettings.isCustom) {
        // 自定义质量参数
        if (formatSettings.videoCodec === 'libx264') {
            args.push('-profile:v', qualitySettings.videoProfile);
            args.push('-b:v', `${qualitySettings.videoBitrate}k`);
            args.push('-r', qualitySettings.videoFramerate.toString());
            args.push('-preset', qualitySettings.preset);
        } else if (formatSettings.videoCodec === 'wmv2') {
            args.push('-b:v', `${qualitySettings.videoBitrate}k`);
        }
        
        // 自定义音频参数
        if (formatSettings.audioCodec === 'aac' || formatSettings.audioCodec === 'mp3') {
            args.push('-b:a', `${qualitySettings.audioBitrate}k`);
            args.push('-ar', qualitySettings.audioSamplerate.toString());
        } else if (formatSettings.audioCodec === 'wmav2') {
            args.push('-b:a', `${qualitySettings.audioBitrate}k`);
        }
    } else {
        // 预设质量参数
        if (formatSettings.videoCodec === 'libx264') {
            args.push('-crf', qualitySettings.crf.toString());
            args.push('-preset', qualitySettings.preset);
            // 添加默认profile设置
            if (qualitySettings.videoProfile) {
                args.push('-profile:v', qualitySettings.videoProfile);
            }
        } else if (formatSettings.videoCodec === 'wmv2') {
            const bitrateMap = { high: '5000k', medium: '2000k', fast: '1000k' };
            args.push('-b:v', bitrateMap[qualitySettings.preset] || '2000k');
        }
        
        // 预设音频比特率
        if (formatSettings.audioCodec === 'aac' || formatSettings.audioCodec === 'mp3') {
            args.push('-b:a', qualitySettings.audioBitrate);
        } else if (formatSettings.audioCodec === 'wmav2') {
            args.push('-b:a', '128k');
        }
    }
    
    // 音频处理
    switch (audioMode) {
        case 'first':
            args.push('-map', '0:a');
            break;
        case 'second':
            args.push('-map', '1:a');
            break;
        case 'mix':
            if (formatSettings.audioCodec !== 'wmav2') {
                args.push('-filter_complex', filterComplex + ';[0:a][1:a]amix=inputs=2[a]', '-map', '[a]');
            } else {
                args.push('-map', '0:a'); // WMV格式简化处理
            }
            break;
        case 'mute':
            args.push('-an');
            break;
        default:
            args.push('-map', '0:a');
    }
    
    // 容器格式
    if (formatSettings.container !== 'auto') {
        args.push('-f', formatSettings.container);
    }
    
    args.push(path.join(outputDir, outputFileName));
    
    return args;
}

async function buildPipArgs(files, outputDir, outputFileName, options, qualitySettings, resolution, formatSettings) {
    if (files.length !== 2) {
        throw new Error('画中画模式需要选择恰好2个视频文件');
    }
    
    const { audioMode, pipPosition, pipSize, background } = options;
    const { width, height } = resolution;
    const backgroundColor = getBackgroundColor(background);
    
    // 获取画中画尺寸
    const pipDimensions = getPipDimensions(width, height, pipSize);
    const overlayPosition = getPipPosition(width, height, pipDimensions, pipPosition);
    
    const filterComplex = 
        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:${backgroundColor}[main];` +
        `[1:v]scale=${pipDimensions.width}:${pipDimensions.height}:force_original_aspect_ratio=decrease[pip];` +
        `[main][pip]overlay=${overlayPosition.x}:${overlayPosition.y}[v]`;
    
    const args = [
        '-i', files[0].path, // 主视频
        '-i', files[1].path, // 画中画视频
        '-filter_complex', filterComplex,
        '-map', '[v]',
        '-c:v', formatSettings.videoCodec,
        '-c:a', formatSettings.audioCodec,
        '-pix_fmt', formatSettings.pixelFormat
    ];
    
    // 根据质量设置添加编码参数
    if (qualitySettings.isCustom) {
        // 自定义质量参数
        if (formatSettings.videoCodec === 'libx264') {
            args.push('-profile:v', qualitySettings.videoProfile);
            args.push('-b:v', `${qualitySettings.videoBitrate}k`);
            args.push('-r', qualitySettings.videoFramerate.toString());
            args.push('-preset', qualitySettings.preset);
        } else if (formatSettings.videoCodec === 'wmv2') {
            args.push('-b:v', `${qualitySettings.videoBitrate}k`);
        }
        
        // 自定义音频参数
        if (formatSettings.audioCodec === 'aac' || formatSettings.audioCodec === 'mp3') {
            args.push('-b:a', `${qualitySettings.audioBitrate}k`);
            args.push('-ar', qualitySettings.audioSamplerate.toString());
        } else if (formatSettings.audioCodec === 'wmav2') {
            args.push('-b:a', `${qualitySettings.audioBitrate}k`);
        }
    } else {
        // 预设质量参数
        if (formatSettings.videoCodec === 'libx264') {
            args.push('-crf', qualitySettings.crf.toString());
            args.push('-preset', qualitySettings.preset);
            // 添加默认profile设置
            if (qualitySettings.videoProfile) {
                args.push('-profile:v', qualitySettings.videoProfile);
            }
        } else if (formatSettings.videoCodec === 'wmv2') {
            const bitrateMap = { high: '5000k', medium: '2000k', fast: '1000k' };
            args.push('-b:v', bitrateMap[qualitySettings.preset] || '2000k');
        }
        
        // 预设音频比特率
        if (formatSettings.audioCodec === 'aac' || formatSettings.audioCodec === 'mp3') {
            args.push('-b:a', qualitySettings.audioBitrate);
        } else if (formatSettings.audioCodec === 'wmav2') {
            args.push('-b:a', '128k');
        }
    }
    
    // 音频处理
    switch (audioMode) {
        case 'first':
            args.push('-map', '0:a');
            break;
        case 'second':
            args.push('-map', '1:a');
            break;
        case 'mix':
            if (formatSettings.audioCodec !== 'wmav2') {
                args.push('-filter_complex', filterComplex + ';[0:a][1:a]amix=inputs=2[a]', '-map', '[a]');
            } else {
                args.push('-map', '0:a'); // WMV格式简化处理
            }
            break;
        case 'mute':
            args.push('-an');
            break;
        default:
            args.push('-map', '0:a');
    }
    
    // 容器格式
    if (formatSettings.container !== 'auto') {
        args.push('-f', formatSettings.container);
    }
    
    args.push(path.join(outputDir, outputFileName));
    
    return args;
}

function getPipDimensions(mainWidth, mainHeight, size) {
    const sizeMap = {
        'small': 6, // 1/6 画面
        'medium': 4, // 1/4 画面
        'large': 3  // 1/3 画面
    };
    
    const divisor = sizeMap[size] || 4;
    return {
        width: Math.floor(mainWidth / divisor),
        height: Math.floor(mainHeight / divisor)
    };
}

function getPipPosition(mainWidth, mainHeight, pipDimensions, position) {
    const margin = 10; // 边距
    
    const positionMap = {
        'top-left': { x: margin, y: margin },
        'top-right': { x: mainWidth - pipDimensions.width - margin, y: margin },
        'bottom-left': { x: margin, y: mainHeight - pipDimensions.height - margin },
        'bottom-right': { x: mainWidth - pipDimensions.width - margin, y: mainHeight - pipDimensions.height - margin }
    };
    
    return positionMap[position] || positionMap['top-right'];
}

function executeFFmpeg(args, logCallback, progressCallback = null, totalDuration = null) {
    return new Promise((resolve, reject) => {
        if (!ffmpegPath) {
            return reject(new Error('FFmpeg not found. Please check your installation and configuration.'));
        }
        
        // 构建完整的命令字符串用于日志
        const command = `${ffmpegPath} ${args.join(' ')}`;
        
        if (logCallback) {
            logCallback('command', `🔧 执行命令: ${command}`);
            if (totalDuration && totalDuration > 0) {
                logCallback('info', `📊 预期处理时长: ${formatTime(totalDuration)} (${totalDuration.toFixed(2)}秒)`);
            }
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
                        
                        // 添加调试日志（每10秒输出一次，或者进度有显著变化时）
                        const isSignificantProgress = Math.floor(currentTime) % 10 === 0;
                        
                        // if (isSignificantProgress && logCallback) {
                        //     logCallback('info', `🕐 进度: ${formatTime(currentTime)}/${formatTime(totalDuration)} (${rawProgressPercent.toFixed(1)}%) - 当前时间戳: ${timeStr}`);
                        // }
                        
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
            if (logCallback) {
                logCallback('info', `🏁 FFmpeg进程结束，退出码: ${code}, 最后处理时间: ${formatTime(lastProgressTime)}`);
            }
            
            if (code === 0) {
                // 只有在成功完成时才显示100%进度
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
                if (logCallback) {
                    logCallback('error', `❌ FFmpeg处理失败，错误信息: ${stderr}`);
                }
                reject(new Error(`FFmpeg_Error: ${stderr}`));
            }
        });
        
        ffmpeg.on('error', (err) => reject(err));
    });
}

// 格式化时间显示
function formatTime(seconds) {
    if (!seconds || seconds < 0) return '00:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
}

function getComposeTypeName(type) {
    const typeNames = {
        'concat': '顺序拼接',
        'sidebyside': '并排显示', 
        'pip': '画中画'
    };
    return typeNames[type] || type;
}

module.exports = { composeVideos };