const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { ffmpegPath, ffprobePath, generateUniqueFilename, getHardwareAccelArgs, getFilterCompatibleHwAccelArgs, getBestHardwareEncoder, getAccelerationType } = require('./common-processor');

// 从video-composer.js借鉴的辅助函数
function getCodecCompatibilityGroup(codec) {
    if (!codec) return 'unknown';
    
    const h264Group = ['h264', 'libx264', 'avc1'];
    const h265Group = ['h265', 'hevc', 'libx265', 'hvc1'];
    const aacGroup = ['aac', 'libfdk_aac'];
    const mp3Group = ['mp3', 'libmp3lame'];
    
    const lowerCodec = codec.toLowerCase();
    
    if (h264Group.some(c => lowerCodec.includes(c))) return 'h264';
    if (h265Group.some(c => lowerCodec.includes(c))) return 'h265';
    if (aacGroup.some(c => lowerCodec.includes(c))) return 'aac';
    if (mp3Group.some(c => lowerCodec.includes(c))) return 'mp3';
    
    return lowerCodec;
}

function areCodecsCompatible(codec1, codec2) {
    return getCodecCompatibilityGroup(codec1) === getCodecCompatibilityGroup(codec2);
}

/**
 * 分析视频文件的编码信息
 */
async function analyzeVideoForIntroOutro(filePath, logCallback) {
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
    
    // 计算帧率
    let frameRate = 25; // 默认值
    if (videoStream.r_frame_rate) {
        const [num, den] = videoStream.r_frame_rate.split('/');
        if (den && parseInt(den) !== 0) {
            frameRate = parseInt(num) / parseInt(den);
        }
    }
    
    return {
        file: filePath,
        fileName: path.basename(filePath),
        videoCodec: videoStream.codec_name,
        audioCodec: audioStream?.codec_name || null,
        // ✅ 新增：完整的音频参数
        audioSampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate) : null,
        audioChannels: audioStream?.channels || null,
        audioChannelLayout: audioStream?.channel_layout || null,
        frameRate: frameRate,
        width: videoStream.width,
        height: videoStream.height,
        pixelFormat: videoStream.pix_fmt,
        duration: parseFloat(info.format.duration || 0)
    };
}

/**
 * 判断片头片尾文件是否需要预处理
 */
function needsPreprocessingForIntroOutro(referenceVideo, introInfo, outroInfo, logCallback) {
    const filesToPreprocess = [];
    let useQuickTSConversion = false;
    
    const referenceCodec = getCodecCompatibilityGroup(referenceVideo.videoCodec);
    const referenceAudioCodec = getCodecCompatibilityGroup(referenceVideo.audioCodec);
    const referenceFrameRate = Math.round(referenceVideo.frameRate * 100) / 100;
    const referenceResolution = `${referenceVideo.width}x${referenceVideo.height}`;
    const referencePixelFormat = referenceVideo.pixelFormat;
    
    if (logCallback) {
        logCallback('info', `🎯 基准视频格式: ${referenceVideo.videoCodec}/${referenceVideo.audioCodec}, ${referenceResolution}, ${referenceFrameRate}fps`);
    }
    
    // 检查片头文件
    if (introInfo) {
        const introCodec = getCodecCompatibilityGroup(introInfo.videoCodec);
        const introAudioCodec = getCodecCompatibilityGroup(introInfo.audioCodec);
        const introFrameRate = Math.round(introInfo.frameRate * 100) / 100;
        const introResolution = `${introInfo.width}x${introInfo.height}`;
        const introPixelFormat = introInfo.pixelFormat;
        
        const needsPreprocessing = 
            introCodec !== referenceCodec ||
            introAudioCodec !== referenceAudioCodec ||
            Math.abs(introFrameRate - referenceFrameRate) > 0.01 || // ✅ 更严格的帧率检测
            introResolution !== referenceResolution ||
            introPixelFormat !== referencePixelFormat ||
            // ✅ 新增：音频参数检测
            (introInfo.audioSampleRate && referenceVideo.audioSampleRate && 
             introInfo.audioSampleRate !== referenceVideo.audioSampleRate) ||
            (introInfo.audioChannels && referenceVideo.audioChannels && 
             introInfo.audioChannels !== referenceVideo.audioChannels);
            
        if (needsPreprocessing) {
            filesToPreprocess.push({
                type: 'intro',
                info: introInfo,
                reasons: {
                    videoCodec: introCodec !== referenceCodec,
                    audioCodec: introAudioCodec !== referenceAudioCodec,
                    frameRate: Math.abs(introFrameRate - referenceFrameRate) > 0.01,
                    resolution: introResolution !== referenceResolution,
                    pixelFormat: introPixelFormat !== referencePixelFormat,
                    // ✅ 新增：音频参数原因
                    audioSampleRate: (introInfo.audioSampleRate && referenceVideo.audioSampleRate && 
                                     introInfo.audioSampleRate !== referenceVideo.audioSampleRate),
                    audioChannels: (introInfo.audioChannels && referenceVideo.audioChannels && 
                                   introInfo.audioChannels !== referenceVideo.audioChannels)
                }
            });
        }
    }
    
    // 检查片尾文件
    if (outroInfo) {
        const outroCodec = getCodecCompatibilityGroup(outroInfo.videoCodec);
        const outroAudioCodec = getCodecCompatibilityGroup(outroInfo.audioCodec);
        const outroFrameRate = Math.round(outroInfo.frameRate * 100) / 100;
        const outroResolution = `${outroInfo.width}x${outroInfo.height}`;
        const outroPixelFormat = outroInfo.pixelFormat;
        
        const needsPreprocessing = 
            outroCodec !== referenceCodec ||
            outroAudioCodec !== referenceAudioCodec ||
            Math.abs(outroFrameRate - referenceFrameRate) > 0.01 || // ✅ 更严格的帧率检测
            outroResolution !== referenceResolution ||
            outroPixelFormat !== referencePixelFormat ||
            // ✅ 新增：音频参数检测
            (outroInfo.audioSampleRate && referenceVideo.audioSampleRate && 
             outroInfo.audioSampleRate !== referenceVideo.audioSampleRate) ||
            (outroInfo.audioChannels && referenceVideo.audioChannels && 
             outroInfo.audioChannels !== referenceVideo.audioChannels);
            
        if (needsPreprocessing) {
            filesToPreprocess.push({
                type: 'outro',
                info: outroInfo,
                reasons: {
                    videoCodec: outroCodec !== referenceCodec,
                    audioCodec: outroAudioCodec !== referenceAudioCodec,
                    frameRate: Math.abs(outroFrameRate - referenceFrameRate) > 0.01,
                    resolution: outroResolution !== referenceResolution,
                    pixelFormat: outroPixelFormat !== referencePixelFormat,
                    // ✅ 新增：音频参数原因
                    audioSampleRate: (outroInfo.audioSampleRate && referenceVideo.audioSampleRate && 
                                     outroInfo.audioSampleRate !== referenceVideo.audioSampleRate),
                    audioChannels: (outroInfo.audioChannels && referenceVideo.audioChannels && 
                                   outroInfo.audioChannels !== referenceVideo.audioChannels)
                }
            });
        }
    }
    
    // 智能判断：如果所有文件都是H.264且只有轻微差异，考虑使用TS转换
    if (filesToPreprocess.length > 0) {
        const allFiles = [referenceVideo];
        if (introInfo) allFiles.push(introInfo);
        if (outroInfo) allFiles.push(outroInfo);
        
        const allH264 = allFiles.every(video => 
            getCodecCompatibilityGroup(video.videoCodec) === 'h264'
        );
        
        // 检查是否只是轻微差异（分辨率和帧率相同，只是编码器不同）
        const minorDifferencesOnly = filesToPreprocess.every(file => {
            const reasons = file.reasons;
            return !reasons.resolution && !reasons.frameRate && !reasons.pixelFormat;
        });
        
        if (allH264 && minorDifferencesOnly) {
            useQuickTSConversion = true;
            if (logCallback) {
                logCallback('info', `⚡ 检测到相同H.264格式视频，将使用快速TS转换方法（无损、速度快）`);
            }
        }
    }
    
    return {
        needsPreprocessing: filesToPreprocess.length > 0,
        useQuickTSConversion,
        filesToPreprocess,
        referenceVideo
    };
}

/**
 * 处理视频片头片尾替换
 * @param {Function} progressCallback - 进度回调函数
 * @param {Function} logCallback - 日志回调函数
 * @param {string} outputPath - 输出路径
 * @param {Array} files - 要处理的文件列表
 * @param {Object} options - 处理选项
 */
async function processIntroOutro(progressCallback, logCallback, outputPath, files, options, shouldStopCallback = null) {
    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });

    const {
        replaceIntro,
        replaceOutro,
        introFile,
        outroFile,
        introTrimSeconds,
        outroTrimSeconds,
        quality
    } = options;

    if (logCallback) {
        logCallback('info', '🎬 开始处理视频片头片尾');
        logCallback('info', `📁 输出目录: ${outputDir}`);
        logCallback('info', `🎯 处理选项: 替换片头=${replaceIntro}, 替换片尾=${replaceOutro}`);
    }

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < files.length; i++) {
        // 检查是否应该停止处理
        if (shouldStopCallback && shouldStopCallback()) {
            if (logCallback) {
                logCallback('warning', '⏹️ 片头片尾处理被用户停止');
            }
            throw new Error('片头片尾处理被用户停止');
        }
        
        const file = files[i];
        
        try {
            if (progressCallback) {
                progressCallback({
                    current: i,
                    total: files.length,
                    status: 'processing',
                    file: `处理中: ${file.name}`
                });
            }

            // 生成输出文件夹和文件名
            const fileExt = path.extname(file.name);
            const baseName = path.basename(file.name, fileExt);
            
            // 为每个文件创建独立的子文件夹
            const fileOutputDir = path.join(outputDir, `片头片尾处理_${baseName}`);
            await fs.mkdir(fileOutputDir, { recursive: true });
            
            // 使用原文件名作为输出文件名
            const outputFilePath = path.join(fileOutputDir, file.name);

            if (logCallback) {
                logCallback('info', `🎥 处理文件: ${file.name}`);
                logCallback('info', `📁 输出目录: ${path.basename(fileOutputDir)}`);
                logCallback('info', `📤 输出文件: ${file.name}`);
            }

            // 处理单个视频 - 使用新的智能预处理逻辑
            await processVideoIntroOutroSmart(file.path, outputFilePath, {
                replaceIntro,
                replaceOutro,
                introFile,
                outroFile,
                introTrimSeconds,
                outroTrimSeconds,
                quality
            }, logCallback, progressCallback, shouldStopCallback);

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
            current: files.length,
            total: files.length,
            status: 'complete',
            file: `处理完成: 成功 ${successCount}, 失败 ${errorCount}`
        });
    }

    if (logCallback) {
        logCallback('success', `🎉 片头片尾处理完成: 成功 ${successCount}, 失败 ${errorCount}`);
    }
}

/**
 * 智能处理单个视频的片头片尾（参考video-composer.js逻辑）
 */
async function processVideoIntroOutroSmart(inputPath, outputPath, options, logCallback, progressCallback, shouldStopCallback = null) {
    const {
        replaceIntro,
        replaceOutro,
        introFile,
        outroFile,
        introTrimSeconds,
        outroTrimSeconds,
        quality
    } = options;

    let tempDir = null;
    const tempFiles = [];

    try {
        // 步骤1: 分析所有视频文件的格式信息
        if (logCallback) {
            logCallback('info', '🔍 分析视频格式信息...');
        }

        const originalVideoInfo = await analyzeVideoForIntroOutro(inputPath, logCallback);
        
        let introInfo = null;
        let outroInfo = null;
        
        if (replaceIntro && introFile) {
            introInfo = await analyzeVideoForIntroOutro(introFile, logCallback);
        }
        
        if (replaceOutro && outroFile) {
            outroInfo = await analyzeVideoForIntroOutro(outroFile, logCallback);
        }
        
        // 计算预期处理时长（用于进度显示）
        let totalExpectedDuration = 0;
        
        // 主视频裁剪后的时长
        if (introTrimSeconds || outroTrimSeconds) {
            const trimmedDuration = originalVideoInfo.duration - (introTrimSeconds || 0) - (outroTrimSeconds || 0);
            totalExpectedDuration += Math.max(trimmedDuration, 0);
        } else {
            totalExpectedDuration += originalVideoInfo.duration;
        }
        
        // 添加片头时长
        if (replaceIntro && introInfo) {
            totalExpectedDuration += introInfo.duration;
        }
        
        // 添加片尾时长
        if (replaceOutro && outroInfo) {
            totalExpectedDuration += outroInfo.duration;
        }
        
        if (logCallback && totalExpectedDuration > 0) {
            logCallback('info', `⏱️ 预期输出时长: ${formatTime(totalExpectedDuration)} (原始: ${formatTime(originalVideoInfo.duration)})`);
        }

        // 步骤2: 判断是否需要预处理片头片尾文件
        const preprocessingResult = needsPreprocessingForIntroOutro(originalVideoInfo, introInfo, outroInfo, logCallback);
        
        // 步骤3: 处理原视频（去除片头片尾）
        let processedMainVideo = inputPath;
        
        if (introTrimSeconds > 0 || outroTrimSeconds > 0) {
            const outputDir = path.dirname(outputPath);
            tempDir = path.join(outputDir, 'temp_intro_outro');
            await fs.mkdir(tempDir, { recursive: true });
            
            const tempMainVideo = path.join(tempDir, 'trimmed_main.mp4');
            tempFiles.push(tempMainVideo);
            
            const startTime = introTrimSeconds || 0;
            const duration = originalVideoInfo.duration - startTime - (outroTrimSeconds || 0);
            
            if (duration <= 0) {
                throw new Error('裁剪后的视频时长不能为负数或零');
            }
            
            if (logCallback) {
                logCallback('info', `✂️ 裁剪主视频: 开始时间=${startTime}秒, 时长=${formatTime(duration)}秒`);
            }

            const trimArgs = [
                '-i', inputPath,
                '-ss', startTime.toString(),
                '-t', duration.toString()
            ];

            // 根据质量设置选择编码参数
            if (quality === 'copy') {
                trimArgs.push('-c', 'copy');
                if (logCallback) {
                    logCallback('warning', '⚠️ 快速模式：可能不精确，受关键帧限制');
                }
            } else {
                // 重编码模式需要详细的视频信息用于质量匹配
                if (logCallback) {
                    logCallback('info', '🎯 使用重编码模式，实现精确裁剪');
                }
                
                // 使用增强的视频分析获取详细信息(包括比特率)
                const detailedVideoInfo = await analyzeVideoForQualityMatch(inputPath, logCallback);
                trimArgs.push(...getQualitySettings(quality, detailedVideoInfo, logCallback));
            }

            trimArgs.push('-y', tempMainVideo);

            // 计算裁剪操作的预期时长
            const trimDuration = originalVideoInfo.duration - (introTrimSeconds || 0) - (outroTrimSeconds || 0);
            
            await executeFFmpeg(trimArgs, logCallback, progressCallback, Math.max(trimDuration, 0));
            processedMainVideo = tempMainVideo;
        }

        // 步骤4: 如果不需要添加片头片尾，直接返回
        if (!replaceIntro && !replaceOutro) {
            if (processedMainVideo !== inputPath) {
                await fs.copyFile(processedMainVideo, outputPath);
            } else {
                await fs.copyFile(inputPath, outputPath);
            }
            return;
        }

        // 步骤5: 智能预处理片头片尾文件
        let finalIntroFile = introFile;
        let finalOutroFile = outroFile;

        if (preprocessingResult.needsPreprocessing) {
            if (!tempDir) {
                const outputDir = path.dirname(outputPath);
                tempDir = path.join(outputDir, 'temp_intro_outro');
                await fs.mkdir(tempDir, { recursive: true });
            }

            if (preprocessingResult.useQuickTSConversion) {
                // 使用快速TS转换
                const tsResults = await convertToTSFormatIntroOutro(
                    originalVideoInfo, 
                    introInfo, 
                    outroInfo, 
                    tempDir, 
                    logCallback,
                    shouldStopCallback
                );
                
                processedMainVideo = tsResults.mainVideo || processedMainVideo;
                finalIntroFile = tsResults.introFile || finalIntroFile;
                finalOutroFile = tsResults.outroFile || finalOutroFile;
                
                // 添加到临时文件列表
                if (tsResults.tempFiles) {
                    tempFiles.push(...tsResults.tempFiles);
                }
            } else {
                // 使用完整重编码预处理
                const preprocessResults = await preprocessIntroOutroFiles(
                    originalVideoInfo,
                    preprocessingResult.filesToPreprocess,
                    tempDir,
                    logCallback,
                    shouldStopCallback
                );
                
                if (preprocessResults.introFile) {
                    finalIntroFile = preprocessResults.introFile;
                    tempFiles.push(finalIntroFile);
                }
                
                if (preprocessResults.outroFile) {
                    finalOutroFile = preprocessResults.outroFile;
                    tempFiles.push(finalOutroFile);
                }
            }
        }

        // 步骤6: 最终concat合成
        if (logCallback) {
            logCallback('info', '🎬 开始最终视频合成...');
        }
        
        // 获取主视频的详细信息用于质量匹配
        let mainVideoDetailedInfo = null;
        if (quality !== 'copy') {
            try {
                mainVideoDetailedInfo = await analyzeVideoForQualityMatch(processedMainVideo, logCallback);
            } catch (error) {
                if (logCallback) {
                    logCallback('warning', `⚠️ 无法分析处理后主视频信息: ${error.message}`);
                }
            }
        }
        
        await concatVideosIntroOutro(
            processedMainVideo,
            finalIntroFile,
            finalOutroFile,
            outputPath,
            replaceIntro,
            replaceOutro,
            quality,
            logCallback,
            progressCallback,
            totalExpectedDuration,
            mainVideoDetailedInfo
        );

    } finally {
        // 清理临时文件和目录
        let cleanedFiles = 0;
        for (const tempFile of tempFiles) {
            try {
                await fs.unlink(tempFile);
                cleanedFiles++;
            } catch (error) {
                // 忽略清理错误（文件可能不存在）
            }
        }
        
        if (tempDir) {
            try {
                await fs.rmdir(tempDir, { recursive: true });
                if (logCallback && cleanedFiles > 0) {
                    logCallback('info', `🧹 清理完成: ${cleanedFiles} 个临时文件和临时目录`);
                }
            } catch (error) {
                // 忽略清理错误（目录可能不存在）
            }
        } else if (logCallback && cleanedFiles > 0) {
            logCallback('info', `🧹 清理完成: ${cleanedFiles} 个临时文件`);
        }
    }
}

/**
 * 快速TS转换用于片头片尾处理
 */
async function convertToTSFormatIntroOutro(originalVideoInfo, introInfo, outroInfo, tempDir, logCallback, shouldStopCallback = null) {
    const results = {
        mainVideo: null,
        introFile: null,
        outroFile: null,
        tempFiles: []
    };

    if (logCallback) {
        logCallback('info', '⚡ 使用快速TS转换模式（无损处理）...');
    }

    // 转换片头文件
    if (introInfo) {
        const tsIntroPath = path.join(tempDir, 'intro.ts');
        const args = [
            '-i', introInfo.file,
            '-c', 'copy',
            '-bsf:v', 'h264_mp4toannexb',
            '-y', tsIntroPath
        ];
        
        if (logCallback) {
            logCallback('info', `🔄 TS转换片头: ${introInfo.fileName}`);
        }
        
        await executeFFmpeg(args, logCallback);
        results.introFile = tsIntroPath;
        results.tempFiles.push(tsIntroPath);
        
        if (logCallback) {
            logCallback('success', `✅ 片头TS转换完成`);
        }
    }

    // 检查是否应该停止处理
    if (shouldStopCallback && shouldStopCallback()) {
        if (logCallback) {
            logCallback('warning', '⏹️ 片头片尾TS转换被用户停止');
        }
        throw new Error('片头片尾TS转换被用户停止');
    }
    
    // 转换片尾文件
    if (outroInfo) {
        const tsOutroPath = path.join(tempDir, 'outro.ts');
        const args = [
            '-i', outroInfo.file,
            '-c', 'copy',
            '-bsf:v', 'h264_mp4toannexb',
            '-y', tsOutroPath
        ];
        
        if (logCallback) {
            logCallback('info', `🔄 TS转换片尾: ${outroInfo.fileName}`);
        }
        
        await executeFFmpeg(args, logCallback);
        results.outroFile = tsOutroPath;
        results.tempFiles.push(tsOutroPath);
        
        if (logCallback) {
            logCallback('success', `✅ 片尾TS转换完成`);
        }
    }

    return results;
}

/**
 * 完整重编码预处理片头片尾文件
 */
async function preprocessIntroOutroFiles(referenceVideo, filesToPreprocess, tempDir, logCallback, shouldStopCallback = null) {
    const results = {
        introFile: null,
        outroFile: null
    };

    if (logCallback) {
        logCallback('info', '🔄 使用完整重编码预处理模式...');
        logCallback('info', `🎯 目标格式: ${referenceVideo.videoCodec}/${referenceVideo.audioCodec}, ${referenceVideo.width}x${referenceVideo.height}, ${referenceVideo.frameRate}fps`);
    }

    for (const fileToPreprocess of filesToPreprocess) {
        // 检查是否应该停止处理
        if (shouldStopCallback && shouldStopCallback()) {
            if (logCallback) {
                logCallback('warning', '⏹️ 片头片尾预处理被用户停止');
            }
            throw new Error('片头片尾预处理被用户停止');
        }
        
        const { type, info } = fileToPreprocess;
        const outputFileName = `preprocessed_${type}.mp4`;
        const outputPath = path.join(tempDir, outputFileName);

        if (logCallback) {
            logCallback('info', `🔄 预处理${type === 'intro' ? '片头' : '片尾'}: ${info.fileName}`);
        }

        // 构建预处理参数，以参考视频的格式为准
        const args = [
            '-i', info.file,
            '-c:v', referenceVideo.videoCodec === 'h264' ? 'libx264' : referenceVideo.videoCodec,
            '-pix_fmt', referenceVideo.pixelFormat,
            '-vf', `scale=${referenceVideo.width}:${referenceVideo.height}:force_original_aspect_ratio=decrease,pad=${referenceVideo.width}:${referenceVideo.height}:(ow-iw)/2:(oh-ih)/2:black`,
            '-r', referenceVideo.frameRate.toString()
        ];

        // 音频处理 - ✅ 根据参考视频参数进行精确匹配
        if (referenceVideo.audioCodec) {
            const audioCodec = referenceVideo.audioCodec === 'aac' ? 'aac' : referenceVideo.audioCodec;
            args.push('-c:a', audioCodec);
            
            // ✅ 音频采样率匹配
            if (referenceVideo.audioSampleRate) {
                args.push('-ar', referenceVideo.audioSampleRate.toString());
            }
            
            // ✅ 音频通道数匹配  
            if (referenceVideo.audioChannels) {
                args.push('-ac', referenceVideo.audioChannels.toString());
            }
            
            // ✅ 智能比特率设置
            if (audioCodec === 'aac') {
                const bitrate = referenceVideo.audioChannels > 2 ? '192k' : '128k';
                args.push('-b:a', bitrate);
            }
        } else {
            args.push('-an'); // 无音频
        }

        args.push('-y', outputPath);

        await executeFFmpeg(args, logCallback);

        if (type === 'intro') {
            results.introFile = outputPath;
        } else if (type === 'outro') {
            results.outroFile = outputPath;
        }

        if (logCallback) {
            logCallback('success', `✅ ${type === 'intro' ? '片头' : '片尾'}预处理完成`);
        }
    }

    return results;
}

/**
 * 最终concat合成
 */
async function concatVideosIntroOutro(mainVideo, introFile, outroFile, outputPath, replaceIntro, replaceOutro, quality, logCallback, progressCallback = null, totalDuration = null, mainVideoInfo = null) {
    const tempFiles = [];

    if (logCallback) {
        logCallback('info', '🎬 开始最终视频合成...');
    }

    // ✅ Filter_complex合成前的最终格式验证
    let processedIntroFile = introFile;
    let processedOutroFile = outroFile;
    
    if (replaceIntro || replaceOutro) {
        if (logCallback) {
            logCallback('info', '🔍 验证片头片尾格式一致性...');
        }
        
        // 分析主视频格式
        const mainVideoFormat = await analyzeVideoForIntroOutro(mainVideo, logCallback);
        
        // 检查和处理片头
        if (replaceIntro && introFile) {
            const introFormat = await analyzeVideoForIntroOutro(introFile, logCallback);
            const needsIntroConvert = await checkFormatConsistency(mainVideoFormat, introFormat, '片头', logCallback);
            
            if (needsIntroConvert) {
                const tempDir = path.dirname(outputPath);
                const introTempDir = path.join(tempDir, 'temp_format_fix');
                await fs.mkdir(introTempDir, { recursive: true });
                
                const convertedIntro = path.join(introTempDir, 'converted_intro.mp4');
                await convertToMatchFormat(introFile, convertedIntro, mainVideoFormat, logCallback);
                processedIntroFile = convertedIntro;
                tempFiles.push(convertedIntro);
            }
        }
        
        // 检查和处理片尾
        if (replaceOutro && outroFile) {
            const outroFormat = await analyzeVideoForIntroOutro(outroFile, logCallback);
            const needsOutroConvert = await checkFormatConsistency(mainVideoFormat, outroFormat, '片尾', logCallback);
            
            if (needsOutroConvert) {
                const tempDir = path.dirname(outputPath);
                const outroTempDir = path.join(tempDir, 'temp_format_fix');
                await fs.mkdir(outroTempDir, { recursive: true });
                
                const convertedOutro = path.join(outroTempDir, 'converted_outro.mp4');
                await convertToMatchFormat(outroFile, convertedOutro, mainVideoFormat, logCallback);
                processedOutroFile = convertedOutro;
                tempFiles.push(convertedOutro);
            }
        }
    }

    // ✅ 采用shell脚本的filter_complex方式，避免时间戳问题
    const ffmpegArgs = [];
    
    // 添加兼容过滤器的硬件加速支持（避免D3D11格式问题）
    ffmpegArgs.push(...getFilterCompatibleHwAccelArgs());
    
    const inputFiles = [];
    let videoProcessing = '';  // 视频流处理部分
    let concatInputs = '';     // concat输入部分
    let inputIndex = 0;

    // 构建输入文件列表和filter (完全按照shell脚本逻辑)
    if (replaceIntro && processedIntroFile) {
        ffmpegArgs.push('-i', processedIntroFile);
        inputFiles.push(processedIntroFile);
        videoProcessing += `[${inputIndex}:v]setsar=1/1,setdar=16/9[v${inputIndex}];`;
        concatInputs += `[v${inputIndex}][${inputIndex}:a]`;
        inputIndex++;
        if (logCallback) {
            logCallback('info', `🎬 添加片头: ${path.basename(processedIntroFile)}`);
        }
    }

    // 主视频
    ffmpegArgs.push('-i', mainVideo);
    inputFiles.push(mainVideo);
    videoProcessing += `[${inputIndex}:v]setsar=1/1,setdar=16/9[v${inputIndex}];`;
    concatInputs += `[v${inputIndex}][${inputIndex}:a]`;
    inputIndex++;

    if (replaceOutro && processedOutroFile) {
        ffmpegArgs.push('-i', processedOutroFile);
        inputFiles.push(processedOutroFile);
        videoProcessing += `[${inputIndex}:v]setsar=1/1,setdar=16/9[v${inputIndex}];`;
        concatInputs += `[v${inputIndex}][${inputIndex}:a]`;
        inputIndex++;
        if (logCallback) {
            logCallback('info', `🎭 添加片尾: ${path.basename(processedOutroFile)}`);
        }
    }

    // 构建完整的filter_complex命令 (完全按照shell脚本格式)
    const filterComplex = `${videoProcessing}${concatInputs}concat=n=${inputIndex}:v=1:a=1[v][a]`;
    
    ffmpegArgs.push('-filter_complex', filterComplex);
    ffmpegArgs.push('-map', '[v]', '-map', '[a]');

    // 根据质量设置选择编码参数 (跨平台兼容)
    if (quality === 'copy') {
        // filter_complex模式不能使用-c copy，使用快速硬件编码
        const encoder = getBestHardwareEncoder('h264', logCallback);
        ffmpegArgs.push('-c:v', encoder);
        
        if (process.platform === 'darwin') {
            ffmpegArgs.push('-profile:v', 'baseline', '-b:v', '8000k', '-preset', 'faster');
        } else {
            ffmpegArgs.push('-preset', 'faster', '-crf', '18');
        }
        
        ffmpegArgs.push('-c:a', 'aac', '-b:a', '128k');
        if (logCallback) {
            logCallback('info', `🚀 使用filter_complex模式，采用${getAccelerationType()}加速编码`);
        }
    } else {
        // 如果需要重编码且有主视频信息，使用详细信息进行质量匹配
        let detailedVideoInfo = mainVideoInfo;
        if (!detailedVideoInfo && mainVideo) {
            try {
                detailedVideoInfo = await analyzeVideoForQualityMatch(mainVideo, logCallback);
            } catch (error) {
                if (logCallback) {
                    logCallback('warning', `⚠️ 无法分析主视频信息，使用默认设置: ${error.message}`);
                }
            }
        }
        ffmpegArgs.push(...getQualitySettings(quality, detailedVideoInfo, logCallback));
    }

    ffmpegArgs.push('-y', outputPath);

    if (logCallback) {
        logCallback('info', `🎬 Filter命令: ${filterComplex}`);
        logCallback('info', `📋 输入文件数量: ${inputIndex}`);
    }

    try {
        await executeFFmpeg(ffmpegArgs, logCallback, progressCallback, totalDuration);
        
        if (logCallback) {
            logCallback('success', '🎉 视频合成完成');
        }
    } finally {
        // 清理临时文件
        for (const tempFile of tempFiles) {
            try {
                await fs.unlink(tempFile);
            } catch (error) {
                // 忽略清理错误
            }
        }
    }
}

/**
 * 运行ffprobe命令（从video-composer.js借鉴）
 */
async function runFfprobe(args) {
    return new Promise((resolve, reject) => {
        const ffprobe = spawn(ffprobePath, args);
        
        let stdout = '';
        let stderr = '';
        
        ffprobe.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        ffprobe.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        ffprobe.on('close', (code) => {
            if (code === 0) {
                try {
                    resolve(JSON.parse(stdout));
                } catch (e) {
                    reject(new Error(`解析JSON失败: ${e.message}`));
                }
            } else {
                reject(new Error(`ffprobe命令失败 (退出码: ${code}): ${stderr}`));
            }
        });
        
        ffprobe.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * 获取视频信息
 */
async function getVideoInfo(videoPath) {
    return new Promise((resolve, reject) => {
        const ffprobe = spawn(ffprobePath, [
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_format',
            videoPath
        ]);

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
                    const info = JSON.parse(output);
                    resolve({
                        duration: parseFloat(info.format.duration || 0)
                    });
                } catch (e) {
                    reject(new Error(`解析视频信息失败: ${e.message}`));
                }
            } else {
                reject(new Error(`获取视频信息失败: ${errorOutput}`));
            }
        });

        ffprobe.on('error', (err) => {
            reject(err);
        });
    });
}

// 已移除误导性的processPreciseLossless函数
// 原因：TS转换并不能真正绕过关键帧限制

/**
 * 获取质量设置
 */
function getQualitySettings(quality, originalVideoInfo = null, logCallback = null) {
    switch(quality) {
        case 'copy':
            // 快速模式，直接copy（可能不精确）
            return ['-c', 'copy'];
            
        case 'quality-match':
            // 智能质量匹配模式，使用原视频参数
            if (originalVideoInfo) {
                return getQualityMatchSettings(originalVideoInfo, logCallback);
            }
            // 如果没有原视频信息，使用高质量默认设置
            return ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k'];
            
        case 'high':
            // 高质量重编码
            return ['-c:v', 'libx264', '-crf', '18', '-preset', 'slower', '-c:a', 'aac', '-b:a', '192k'];
            
        case 'medium':
            // 标准重编码
            return ['-c:v', 'libx264', '-crf', '23', '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k'];
            
        case 'fast':
            // 快速重编码
            return ['-c:v', 'libx264', '-crf', '28', '-preset', 'fast', '-c:a', 'aac', '-b:a', '96k'];
            
        default:
            // 默认使用智能质量匹配模式
            if (originalVideoInfo) {
                return getQualityMatchSettings(originalVideoInfo, logCallback);
            }
            return ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k'];
    }
}

/**
 * 根据原视频信息生成智能质量匹配设置
 * 自动检测原视频参数，选择最佳的重编码设置
 */
function getQualityMatchSettings(videoInfo, logCallback = null) {
    const settings = [];
    
    if (logCallback) {
        logCallback('info', `🔍 智能质量匹配: 分析原视频参数...`);
    }
    
    // 视频编码器和质量设置
    if (videoInfo.videoCodec) {
        const codec = videoInfo.videoCodec.toLowerCase();
        
        if (logCallback) {
            logCallback('info', `📦 检测到视频编码器: ${codec}`);
        }
        
        if (codec === 'h264' || codec === 'avc1') {
            settings.push('-c:v', 'libx264');
            
            // 优先使用原视频的比特率，如果没有则使用CRF
            if (logCallback) {
                logCallback('info', `📊 检查视频比特率: ${videoInfo.videoBitrate}, 是否有效: ${videoInfo.videoBitrate && videoInfo.videoBitrate > 0}`);
            }
            
            if (videoInfo.videoBitrate && videoInfo.videoBitrate > 0) {
                // 使用原始比特率（稍微提高以补偿重编码损失）
                const targetBitrate = Math.round(videoInfo.videoBitrate * 1.1); // 提高10%
                settings.push('-b:v', `${targetBitrate}`, '-maxrate', `${Math.round(targetBitrate * 1.2)}`, '-bufsize', `${Math.round(targetBitrate * 2)}`);
                if (logCallback) {
                    logCallback('info', `📊 使用原视频比特率: ${Math.round(videoInfo.videoBitrate / 1000)} kb/s → ${Math.round(targetBitrate / 1000)} kb/s`);
                }
            } else {
                // 没有比特率信息，使用CRF
                let crf = '18'; // 默认高质量
                if (videoInfo.width && videoInfo.height) {
                    const pixels = videoInfo.width * videoInfo.height;
                    if (pixels >= 3840 * 2160) {
                        crf = '16'; // 4K使用最高质量
                    } else if (pixels >= 1920 * 1080) {
                        crf = '18'; // 1080p使用高质量
                    } else if (pixels >= 1280 * 720) {
                        crf = '20'; // 720p使用中高质量
                    } else {
                        crf = '22'; // 较低分辨率使用中质量
                    }
                }
                settings.push('-crf', crf);
                if (logCallback) {
                    logCallback('info', `📊 使用CRF模式: CRF=${crf}`);
                }
            }
            
            // H.264 Profile设置
            if (videoInfo.videoProfile) {
                const profile = videoInfo.videoProfile.toLowerCase();
                if (['baseline', 'main', 'high'].includes(profile)) {
                    settings.push('-profile:v', profile);
                    if (logCallback) {
                        logCallback('info', `📝 保持H.264 Profile: ${profile}`);
                    }
                }
            } else {
                settings.push('-profile:v', 'baseline'); // 默认使用baseline profile以获得最佳兼容性
            }
            
            // Level设置（如果有）
            if (videoInfo.videoLevel) {
                settings.push('-level', videoInfo.videoLevel.toString());
                if (logCallback) {
                    logCallback('info', `📝 保持H.264 Level: ${videoInfo.videoLevel}`);
                }
            }
            
            // 像素格式
            if (videoInfo.pixelFormat) {
                settings.push('-pix_fmt', videoInfo.pixelFormat);
            } else {
                settings.push('-pix_fmt', 'yuv420p'); // 默认兼容性最好
            }
            
            // 帧率
            if (videoInfo.frameRate && videoInfo.frameRate > 0) {
                settings.push('-r', videoInfo.frameRate.toString());
                if (logCallback) {
                    logCallback('info', `🕰 保持帧率: ${videoInfo.frameRate.toFixed(2)} fps`);
                }
            }
            
            // SAR/DAR设置
            if (videoInfo.sar && videoInfo.sar !== '1:1') {
                settings.push('-aspect', videoInfo.dar || `${videoInfo.width}:${videoInfo.height}`);
                if (logCallback) {
                    logCallback('info', `🖼 SAR: ${videoInfo.sar}, DAR: ${videoInfo.dar}`);
                }
            }
            
            // 编码预设（平衡速度和质量）
            settings.push('-preset', 'medium');
            
        } else if (codec === 'hevc' || codec === 'h265') {
            // H.265视频使用libx265
            settings.push('-c:v', 'libx265');
            
            if (videoInfo.videoBitrate && videoInfo.videoBitrate > 0) {
                const targetBitrate = Math.round(videoInfo.videoBitrate * 1.1);
                settings.push('-b:v', `${targetBitrate}`);
            } else {
                settings.push('-crf', '20'); // H.265可以使用稍高的CRF
            }
            
            settings.push('-preset', 'medium');
            
            if (videoInfo.pixelFormat) {
                settings.push('-pix_fmt', videoInfo.pixelFormat);
            }
            
        } else {
            // 其他编码器，默认使用x264
            settings.push('-c:v', 'libx264', '-crf', '18', '-preset', 'medium');
            if (logCallback) {
                logCallback('warning', `⚠️ 未知编码器 ${codec}，使用默认x264设置`);
            }
        }
    } else {
        // 没有编码器信息，默认高质量x264
        settings.push('-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p');
        if (logCallback) {
            logCallback('warning', `⚠️ 未检测到视频编码器（videoCodec: ${videoInfo.videoCodec}），使用默认x264设置`);
        }
    }
    
    // 音频编码器和质量设置
    if (videoInfo.audioCodec) {
        const audioCodec = videoInfo.audioCodec.toLowerCase();
        
        if (logCallback) {
            logCallback('info', `🎵 检测到音频编码器: ${audioCodec}`);
        }
        
        if (audioCodec === 'aac') {
            settings.push('-c:a', 'aac');
            
            // 优先使用原始音频比特率
            if (videoInfo.audioBitrate && videoInfo.audioBitrate > 0) {
                // 使用原始比特率，但不低于128k
                const originalBitrate = Math.round(videoInfo.audioBitrate / 1000);
                const targetBitrate = Math.max(originalBitrate, 128);
                settings.push('-b:a', `${targetBitrate}k`);
                if (logCallback) {
                    logCallback('info', `🎵 使用原始音频比特率: ${originalBitrate}k${targetBitrate !== originalBitrate ? ` → ${targetBitrate}k(最低128k)` : ''}`);
                }
            } else {
                // 根据声道数选择比特率
                const bitrate = videoInfo.audioChannels >= 6 ? '256k' : 
                               videoInfo.audioChannels >= 2 ? '192k' : '128k';
                settings.push('-b:a', bitrate);
                if (logCallback) {
                    logCallback('info', `🎵 根据声道数(${videoInfo.audioChannels || 2})选择比特率: ${bitrate}`);
                }
            }
            
            // 保持采样率
            if (videoInfo.sampleRate && videoInfo.sampleRate !== 48000) {
                settings.push('-ar', videoInfo.sampleRate.toString());
                if (logCallback) {
                    logCallback('info', `🎵 保持采样率: ${videoInfo.sampleRate} Hz`);
                }
            }
            
            // 保持声道数
            if (videoInfo.audioChannels) {
                settings.push('-ac', videoInfo.audioChannels.toString());
            }
            
        } else if (audioCodec === 'mp3') {
            settings.push('-c:a', 'libmp3lame');
            
            if (videoInfo.audioBitrate && videoInfo.audioBitrate > 0) {
                const targetBitrate = Math.max(videoInfo.audioBitrate, 128000);
                settings.push('-b:a', `${Math.round(targetBitrate / 1000)}k`);
            } else {
                settings.push('-b:a', '192k');
            }
            
        } else {
            // 其他音频编码器，转换为AAC
            settings.push('-c:a', 'aac', '-b:a', '192k');
            if (logCallback) {
                logCallback('info', `🎵 音频编码器 ${audioCodec} 转换为 AAC`);
            }
        }
    } else {
        // 没有音频信息，默认AAC
        settings.push('-c:a', 'aac', '-b:a', '192k');
        if (logCallback) {
            logCallback('warning', `⚠️ 未检测到音频编码器（audioCodec: ${videoInfo.audioCodec}），使用默认AAC设置`);
        }
    }
    
    if (logCallback) {
        const videoCodec = settings.includes('libx264') ? 'H.264' : 
                          settings.includes('libx265') ? 'H.265' : 'Unknown';
        const audioCodec = settings.includes('libmp3lame') ? 'MP3' : 'AAC';
        const encodingMode = settings.includes('-b:v') ? '比特率模式' : 'CRF模式';
        const summary = `${videoCodec}(${encodingMode}) + ${audioCodec}`;
        logCallback('success', `✅ 智能质量匹配完成: ${summary}`);
    }
    
    return settings;
}

/**
 * 增强的视频信息分析函数
 * 获取更详细的视频参数用于质量匹配
 */
async function analyzeVideoForQualityMatch(videoPath, logCallback) {
    try {
        if (logCallback) {
            logCallback('info', '🔍 分析视频参数用于质量匹配...');
        }
        
        // 临时移除-show_entries限制，获取所有信息进行调试
        const data = await runFfprobe([
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            videoPath
        ]);
        const videoStream = data.streams.find(s => s.codec_type === 'video');
        const audioStream = data.streams.find(s => s.codec_type === 'audio');
        
        // 🔧 添加原始数据调试
        if (logCallback) {
            logCallback('info', `🔧 ffprobe原始数据 - format.bit_rate: ${data.format?.bit_rate}, streams数量: ${data.streams?.length}`);
            if (videoStream) {
                logCallback('info', `🔧 视频流信息 - codec: ${videoStream.codec_name}, bit_rate: ${videoStream.bit_rate}, 分辨率: ${videoStream.width}x${videoStream.height}`);
            } else {
                logCallback('warning', '⚠️ 未找到视频流!');
            }
            if (audioStream) {
                logCallback('info', `🔧 音频流信息 - codec: ${audioStream.codec_name}, bit_rate: ${audioStream.bit_rate}, channels: ${audioStream.channels}`);
            } else {
                logCallback('warning', '⚠️ 未找到音频流!');
            }
        }
        
        // 计算帧率（优先使用r_frame_rate）
        let frameRate = null;
        if (videoStream?.r_frame_rate) {
            const [num, den] = videoStream.r_frame_rate.split('/');
            frameRate = den ? parseFloat(num) / parseFloat(den) : parseFloat(num);
        } else if (videoStream?.avg_frame_rate) {
            const [num, den] = videoStream.avg_frame_rate.split('/');
            frameRate = den ? parseFloat(num) / parseFloat(den) : parseFloat(num);
        }
        
        // 计算SAR和DAR
        let sar = null, dar = null;
        if (videoStream?.sample_aspect_ratio && videoStream.sample_aspect_ratio !== '0:1') {
            sar = videoStream.sample_aspect_ratio;
        }
        if (videoStream?.display_aspect_ratio) {
            dar = videoStream.display_aspect_ratio;
        }
        
        // 获取准确的比特率（优先使用format比特率）
        const totalBitrate = data.format?.bit_rate ? parseInt(data.format.bit_rate) : null;
        let videoBitrate = videoStream?.bit_rate ? parseInt(videoStream.bit_rate) : null;
        const audioBitrate = audioStream?.bit_rate ? parseInt(audioStream.bit_rate) : null;
        
        // 🔧 如果没有视频比特率，尝试从总比特率计算
        if (!videoBitrate && totalBitrate && audioBitrate) {
            videoBitrate = totalBitrate - audioBitrate;
            if (logCallback) {
                logCallback('info', `🔧 从总比特率计算视频比特率: ${Math.round(totalBitrate/1000)}k - ${Math.round(audioBitrate/1000)}k = ${Math.round(videoBitrate/1000)}k`);
            }
        } else if (!videoBitrate && totalBitrate) {
            // 如果只有总比特率，估算视频比特率（假设音频占10-15%）
            videoBitrate = Math.round(totalBitrate * 0.85);
            if (logCallback) {
                logCallback('info', `🔧 估算视频比特率(假设音频占15%): ${Math.round(totalBitrate/1000)}k * 0.85 = ${Math.round(videoBitrate/1000)}k`);
            }
        }
        
        const info = {
            // 基础信息
            duration: parseFloat(data.format.duration || 0),
            totalBitrate: totalBitrate,
            
            // 视频参数
            videoCodec: videoStream?.codec_name,
            videoCodecTag: videoStream?.codec_tag_string,
            videoProfile: videoStream?.profile,
            videoLevel: videoStream?.level,
            width: videoStream?.width,
            height: videoStream?.height,
            pixelFormat: videoStream?.pix_fmt,
            frameRate: frameRate,
            videoBitrate: videoBitrate,
            sar: sar,  // Sample Aspect Ratio
            dar: dar,  // Display Aspect Ratio
            timeBase: videoStream?.time_base,
            
            // 音频参数
            audioCodec: audioStream?.codec_name,
            audioProfile: audioStream?.profile,
            audioChannels: audioStream?.channels,
            audioBitrate: audioBitrate,
            sampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate) : null
        };
        
        if (logCallback) {
            const videoInfo = `${info.videoCodec || 'Unknown'}${info.videoProfile ? ` (${info.videoProfile})` : ''}, ${info.pixelFormat || 'Unknown'}, ${info.width || '?'}x${info.height || '?'}`;
            const aspectInfo = info.dar ? ` [DAR ${info.dar}]` : '';
            const bitrateInfo = info.totalBitrate ? `, ${Math.round(info.totalBitrate / 1000)} kb/s` : '';
            const frameRateInfo = info.frameRate ? `, ${info.frameRate.toFixed(0)} fps` : '';
            const summary = `${videoInfo}${aspectInfo}${bitrateInfo}${frameRateInfo}`;
            logCallback('info', `✅ 视频分析完成: ${summary}`);
            
            // 详细参数日志
            if (info.videoProfile) logCallback('info', `📝 视频Profile: ${info.videoProfile}`);
            if (info.videoLevel) logCallback('info', `📝 视频Level: ${info.videoLevel}`);
            if (info.sar) logCallback('info', `📝 SAR: ${info.sar}, DAR: ${info.dar}`);
            
            // 🔧 添加比特率调试信息
            logCallback('info', `🔧 调试信息 - 视频比特率: ${info.videoBitrate || 'null'}, 音频比特率: ${info.audioBitrate || 'null'}, 总比特率: ${info.totalBitrate || 'null'}`);
        }
        
        return info;
        
    } catch (error) {
        if (logCallback) {
            logCallback('warning', `视频分析失败: ${error.message}，使用默认设置`);
        }
        return null;
    }
}

/**
 * 执行FFmpeg命令（支持精确进度显示）
 */
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
                        
                        // 进度日志（每10秒输出一次）
                        const isSignificantProgress = Math.floor(currentTime) % 10 === 0;
                        // if (isSignificantProgress && logCallback) {
                        //     logCallback('info', `🕰 进度: ${formatTime(currentTime)}/${formatTime(totalDuration)} (${rawProgressPercent.toFixed(1)}%)`);
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
        
        ffmpeg.on('error', (err) => {
            if (logCallback) {
                logCallback('error', `❌ FFmpeg进程错误: ${err.message}`);
            }
            reject(err);
        });
    });
}

/**
 * 检查格式一致性
 */
async function checkFormatConsistency(referenceFormat, targetFormat, fileType, logCallback) {
    const issues = [];
    
    // 检查关键参数
    if (targetFormat.videoCodec !== referenceFormat.videoCodec) {
        issues.push(`视频编码: ${targetFormat.videoCodec} → ${referenceFormat.videoCodec}`);
    }
    
    if (targetFormat.audioCodec !== referenceFormat.audioCodec) {
        issues.push(`音频编码: ${targetFormat.audioCodec} → ${referenceFormat.audioCodec}`);
    }
    
    if (targetFormat.width !== referenceFormat.width || targetFormat.height !== referenceFormat.height) {
        issues.push(`分辨率: ${targetFormat.width}x${targetFormat.height} → ${referenceFormat.width}x${referenceFormat.height}`);
    }
    
    if (Math.abs(targetFormat.frameRate - referenceFormat.frameRate) > 0.01) {
        issues.push(`帧率: ${targetFormat.frameRate.toFixed(2)} → ${referenceFormat.frameRate.toFixed(2)}`);
    }
    
    if (targetFormat.pixelFormat !== referenceFormat.pixelFormat) {
        issues.push(`像素格式: ${targetFormat.pixelFormat} → ${referenceFormat.pixelFormat}`);
    }
    
    // 检查音频参数
    if (targetFormat.audioSampleRate && referenceFormat.audioSampleRate && 
        targetFormat.audioSampleRate !== referenceFormat.audioSampleRate) {
        issues.push(`音频采样率: ${targetFormat.audioSampleRate} → ${referenceFormat.audioSampleRate}`);
    }
    
    if (targetFormat.audioChannels && referenceFormat.audioChannels && 
        targetFormat.audioChannels !== referenceFormat.audioChannels) {
        issues.push(`音频通道: ${targetFormat.audioChannels} → ${referenceFormat.audioChannels}`);
    }
    
    if (issues.length > 0) {
        if (logCallback) {
            logCallback('info', `⚠️ ${fileType}格式不一致，需要转换:`);
            issues.forEach(issue => {
                logCallback('info', `   - ${issue}`);
            });
        }
        return true;
    }
    
    if (logCallback) {
        logCallback('info', `✅ ${fileType}格式一致，无需转换`);
    }
    return false;
}

/**
 * 转换文件格式以匹配参考视频
 */
async function convertToMatchFormat(inputFile, outputFile, referenceFormat, logCallback) {
    if (logCallback) {
        logCallback('info', `🔄 转换格式: ${path.basename(inputFile)} → 匹配主视频格式`);
    }
    
    // 判断是否可以使用快速TS转换
    const inputFormat = await analyzeVideoForIntroOutro(inputFile, logCallback);
    const canUseTS = (referenceFormat.videoCodec.toLowerCase().includes('h264') || referenceFormat.videoCodec === 'avc1') && 
                     (inputFormat.videoCodec.toLowerCase().includes('h264') || inputFormat.videoCodec === 'avc1');
    
    if (canUseTS) {
        // 使用快速TS转换方式
        if (logCallback) {
            logCallback('info', '⚡ 使用快速TS转换方式');
        }
        
        const tempTS = outputFile.replace('.mp4', '.ts');
        
        // 步骤1: 转换为TS
        await executeFFmpeg([
            '-i', inputFile,
            '-c', 'copy',
            '-bsf:v', 'h264_mp4toannexb',
            '-y', tempTS
        ], logCallback);
        
        // 步骤2: TS转回MP4并调整格式
        const tsConvertArgs = ['-i', tempTS];
        
        // 跨平台编码器选择
        const encoder = getBestHardwareEncoder('h264', logCallback);
        tsConvertArgs.push('-c:v', encoder, '-profile:v', 'baseline');
        
        tsConvertArgs.push(
            '-pix_fmt', referenceFormat.pixelFormat,
            '-vf', `scale=${referenceFormat.width}:${referenceFormat.height}:force_original_aspect_ratio=decrease,pad=${referenceFormat.width}:${referenceFormat.height}:(ow-iw)/2:(oh-ih)/2:black`,
            '-r', referenceFormat.frameRate.toString(),
            '-c:a', 'aac',
            '-ar', referenceFormat.audioSampleRate ? referenceFormat.audioSampleRate.toString() : '48000',
            '-ac', referenceFormat.audioChannels ? referenceFormat.audioChannels.toString() : '2',
            '-b:a', '128k',
            '-y', outputFile
        );
        
        await executeFFmpeg(tsConvertArgs, logCallback);
        
        // 清理临时TS文件
        try {
            await fs.unlink(tempTS);
        } catch (error) {
            // 忽略清理错误
        }
    } else {
        // 使用完整重编码
        if (logCallback) {
            logCallback('info', '🔄 使用完整重编码方式');
        }
        
        const args = ['-i', inputFile];
        
        // 跨平台编码器选择
        const encoder = getBestHardwareEncoder('h264', logCallback);
        args.push('-c:v', encoder, '-profile:v', 'baseline');
        
        args.push(
            '-pix_fmt', referenceFormat.pixelFormat,
            '-vf', `scale=${referenceFormat.width}:${referenceFormat.height}:force_original_aspect_ratio=decrease,pad=${referenceFormat.width}:${referenceFormat.height}:(ow-iw)/2:(oh-ih)/2:black`,
            '-r', referenceFormat.frameRate.toString()
        );
        
        // 音频处理
        if (referenceFormat.audioCodec) {
            const audioCodec = referenceFormat.audioCodec === 'aac' ? 'aac' : 'aac';
            args.push('-c:a', audioCodec);
            
            if (referenceFormat.audioSampleRate) {
                args.push('-ar', referenceFormat.audioSampleRate.toString());
            }
            
            if (referenceFormat.audioChannels) {
                args.push('-ac', referenceFormat.audioChannels.toString());
            }
            
            args.push('-b:a', '128k');
        } else {
            args.push('-an');
        }
        
        args.push('-y', outputFile);
        
        await executeFFmpeg(args, logCallback);
    }
    
    if (logCallback) {
        logCallback('success', `✅ 格式转换完成: ${path.basename(outputFile)}`);
    }
}

/**
 * 格式化时间显示
 */
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

module.exports = {
    processIntroOutro
};