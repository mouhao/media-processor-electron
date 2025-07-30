const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { ffmpegPath } = require('./common-processor');

async function composeVideos(progressCallback, logCallback, outputPath, files, options) {
    const outputDir = path.join(outputPath, 'video_composition');
    await fs.mkdir(outputDir, { recursive: true });

    const { composeType, filename, format } = options;
    
    try {
        // 生成输出文件名，根据格式添加正确的扩展名
        const outputFileName = `${filename}.${format}`;
        
        if (logCallback) {
            logCallback('info', `🎬 开始合成视频，类型: ${getComposeTypeName(composeType)}`);
            logCallback('info', `📁 输出文件: ${path.join(outputDir, outputFileName)}`);
            logCallback('info', `🎞️ 输出格式: ${format.toUpperCase()}`);
        }
        
        progressCallback({ current: 0, total: 1, status: 'processing', file: '正在分析视频信息...' });
        
        // 获取质量设置和格式配置
        const qualitySettings = getQualitySettings(options.quality);
        const formatSettings = getFormatSettings(format);
        const resolvedResolution = await resolveResolution(files, options.resolution);
        
        progressCallback({ current: 0, total: 1, status: 'processing', file: '正在合成视频...' });
        
        // 构建FFmpeg参数
        let ffmpegArgs;
        switch (composeType) {
            case 'concat':
                ffmpegArgs = await buildConcatArgs(files, outputDir, outputFileName, options, qualitySettings, resolvedResolution, formatSettings);
                break;
            case 'sidebyside':
                ffmpegArgs = await buildSideBySideArgs(files, outputDir, outputFileName, options, qualitySettings, resolvedResolution, formatSettings);
                break;
            case 'pip':
                ffmpegArgs = await buildPipArgs(files, outputDir, outputFileName, options, qualitySettings, resolvedResolution, formatSettings);
                break;
            default:
                throw new Error(`不支持的合成类型: ${composeType}`);
        }
        
        await executeFFmpeg(ffmpegArgs, logCallback);
        
        progressCallback({ current: 1, total: 1, status: 'complete', file: outputFileName });
        
        if (logCallback) {
            logCallback('success', `✅ 视频合成完成: ${outputFileName}`);
        }
        
        return { processed: 1, failed: 0 };
        
    } catch (error) {
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
    
    // 预设质量配置
    const preset = qualityOption.preset || qualityOption;
    const qualityMap = {
        'high': { crf: 18, preset: 'slower', audioBitrate: '192k' },
        'medium': { crf: 23, preset: 'medium', audioBitrate: '128k' },
        'fast': { crf: 28, preset: 'fast', audioBitrate: '96k' }
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
    
    // 创建concat列表文件
    const concatListPath = path.join(outputDir, 'concat_list.txt');
    const concatContent = files.map(file => `file '${file.path.replace(/'/g, "'\"'\"'")}'`).join('\n');
    await fs.writeFile(concatListPath, concatContent);
    
    let videoFilter = buildVideoFilter(resolution, aspectRatio, background);
    
    const args = [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatListPath,
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
    
    // 添加视频滤镜
    if (videoFilter) {
        args.push('-vf', videoFilter);
    }
    
    // 音频处理
    if (audioMode === 'mute') {
        args.push('-an'); // 移除音频
    } else if (audioMode === 'normalize' && formatSettings.audioCodec !== 'wmav2') {
        args.push('-af', 'loudnorm');
    }
    
    // 容器格式
    if (formatSettings.container !== 'auto') {
        args.push('-f', formatSettings.container);
    }
    
    args.push(path.join(outputDir, outputFileName));
    
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

function executeFFmpeg(args, logCallback) {
    return new Promise((resolve, reject) => {
        if (!ffmpegPath) {
            return reject(new Error('FFmpeg not found. Please check your installation and configuration.'));
        }
        
        // 构建完整的命令字符串用于日志
        const command = `${ffmpegPath} ${args.join(' ')}`;
        
        if (logCallback) {
            logCallback('command', `🔧 执行命令: ${command}`);
        }
        
        const ffmpeg = spawn(ffmpegPath, args);
        
        let stderr = '';
        ffmpeg.stderr.on('data', (data) => { 
            stderr += data.toString(); 
        });
        
        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`FFmpeg_Error: ${stderr}`));
            }
        });
        
        ffmpeg.on('error', (err) => reject(err));
    });
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