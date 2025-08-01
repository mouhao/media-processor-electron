const { ipcRenderer } = require('electron');
const path = require('path');

class MediaProcessorApp {
    constructor() {
        this.currentFolder = null;
        this.mediaFiles = { mp3: [], video: [], compose: [], 'intro-outro': [] };
        this.selectedFiles = [];
        this.currentFileType = 'mp3';
        this.isProcessing = false;
        
        // 文件信息加载状态
        this.isLoadingFileDetails = false;
        this.dragDropEnabled = false;
        
        this.initializeElements();
        this.bindEvents();
        this.checkFFmpegStatus();
        
        // 初始化配置面板
        this.updateConfigPanel(this.currentFileType);
        
        // 初始化列宽调整功能
        this.initializeColumnResizer();
    }

    initializeColumnResizer() {
        const resizer = document.querySelector('.column-resizer');
        const nameColumn = document.querySelector('.header-name');
        const container = document.querySelector('.left-panel');
        
        if (!resizer || !nameColumn || !container) return;
        
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;
        
        window.addEventListener('resize', () => {
            this.checkHorizontalScroll();
        });
        
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = nameColumn.offsetWidth;
            
            resizer.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            
            // 创建遮罩层防止鼠标离开
            const overlay = document.createElement('div');
            overlay.id = 'resize-overlay';
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                cursor: col-resize;
                z-index: 9999;
            `;
            document.body.appendChild(overlay);
            
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const deltaX = e.clientX - startX;
            const newWidth = Math.max(200, Math.min(startWidth + deltaX, container.offsetWidth * 0.7));
            
            // 更新CSS变量
            document.documentElement.style.setProperty('--name-column-width', `${newWidth}px`);
            
            // 实时检查水平滚动状态
            this.checkHorizontalScroll();
            
            e.preventDefault();
        });
        
        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('resizing');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                
                // 移除遮罩层
                const overlay = document.getElementById('resize-overlay');
                if (overlay) {
                    overlay.remove();
                }
                
                // 保存设置到localStorage
                const currentWidth = document.documentElement.style.getPropertyValue('--name-column-width');
                if (currentWidth) {
                    localStorage.setItem('nameColumnWidth', currentWidth);
                }
            }
        });
        
        // 恢复保存的列宽设置
        const savedWidth = localStorage.getItem('nameColumnWidth');
        if (savedWidth) {
            document.documentElement.style.setProperty('--name-column-width', savedWidth);
        } else {
            document.documentElement.style.setProperty('--name-column-width', '350px');
        }
    }

    initializeElements() {
        // 按钮和输入元素
        this.selectFolderBtn = document.getElementById('select-folder-btn');
        this.processBtn = document.getElementById('processBtn');
        this.removeSelectedBtn = document.getElementById('removeSelectedBtn');
        this.selectAllCheckbox = document.getElementById('selectAllCheckbox');
        this.selectOutputBtn = document.getElementById('select-output-btn');
        this.outputFolder = document.getElementById('output-folder');
        
        // 显示元素
        this.folderPath = document.getElementById('folder-path');
        this.fileList = document.getElementById('fileList');
        this.fileCountText = document.getElementById('file-count-text');
        this.progressFill = document.getElementById('progress-fill');
        this.progressText = document.getElementById('progress-text');
        this.progressSpinner = document.getElementById('progress-spinner');
        
        // 进度条动画相关属性
        this.simulatedProgress = 0;
        this.progressAnimationId = null;
        this.isRealProgress = false;
        this.lastRealProgress = 0;
        this.progressSpeed = 0.1; // 每100ms增加的百分比
        this.logContent = document.getElementById('log-content');
        this.ffmpegStatus = document.getElementById('ffmpeg-status');
        
        // 标签页和配置
        this.fileTabs = document.querySelectorAll('.file-tab');
        this.tabContents = document.querySelectorAll('.tab-content');
        this.configTitle = document.getElementById('config-title');
        this.composeTip = document.querySelector('.compose-tip');

        // MP3 设置元素
        this.mp3ForceProcessRadios = document.querySelectorAll('input[name="force-process"]');
        this.mp3ThresholdGroup = document.getElementById('mp3-threshold-group');
        
        // 视频合成设置元素
        this.composeTypeSelect = document.getElementById('compose-type');
        this.composeResolutionSelect = document.getElementById('compose-resolution');
        this.composeAspectSelect = document.getElementById('compose-aspect');
        this.composeQualitySelect = document.getElementById('compose-quality');
        this.backgroundColorGroup = document.getElementById('background-color-group');
        this.customResolutionGroup = document.getElementById('custom-resolution-group');
        this.customQualityGroup = document.getElementById('custom-quality-group');
        this.customWidthInput = document.getElementById('custom-width');
        this.customHeightInput = document.getElementById('custom-height');
        this.concatSettings = document.getElementById('concat-settings');
        this.multiVideoSettings = document.getElementById('multi-video-settings');
        this.pipPositionGroup = document.getElementById('pip-position');
        this.pipSizeGroup = document.getElementById('pip-size');
        
        // 片头片尾处理设置元素
        this.replaceIntroRadios = document.querySelectorAll('input[name="replace-intro"]');
        this.replaceOutroRadios = document.querySelectorAll('input[name="replace-outro"]');
        this.introTrimGroup = document.getElementById('intro-trim-group');
        this.outroTrimGroup = document.getElementById('outro-trim-group');
        this.introFileGroup = document.getElementById('intro-file-group');
        this.outroFileGroup = document.getElementById('outro-file-group');
        this.introFileInput = document.getElementById('intro-file');
        this.outroFileInput = document.getElementById('outro-file');
        this.selectIntroBtn = document.getElementById('select-intro-btn');
        this.selectOutroBtn = document.getElementById('select-outro-btn');
    }

    bindEvents() {
        // 文件夹选择
        this.selectFolderBtn.addEventListener('click', () => this.selectFolder());
        
        // 输出文件夹选择
        this.selectOutputBtn.addEventListener('click', () => this.selectOutputFolder());
        
        // 处理按钮
        this.processBtn.addEventListener('click', () => this.startProcessing());
        
        // 移除选中按钮
        this.removeSelectedBtn.addEventListener('click', () => this.removeSelectedFiles());
        
        // 全选复选框
        this.selectAllCheckbox.addEventListener('change', (e) => this.selectAllFiles(e.target.checked));
        
        // 文件类型标签页
        this.fileTabs.forEach(tab => {
            tab.addEventListener('click', (e) => this.switchFileTab(e.target.dataset.type));
        });
        
        // 监听处理进度
        ipcRenderer.on('processing-progress', (event, progress) => {
            this.handleProgressUpdate(progress);
        });

        // 监听处理日志
        ipcRenderer.on('processing-log', (event, log) => {
            this.addLog(log.type, log.message);
        });

        // 监听MP3强制处理单选框变化
        this.mp3ForceProcessRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.mp3ThresholdGroup.style.display = (e.target.value === 'yes') ? 'none' : '';
            });
        });

        // 监听视频合成类型变化
        if (this.composeTypeSelect) {
            this.composeTypeSelect.addEventListener('change', (e) => {
                this.updateComposeSettings(e.target.value);
            });
        }

        // 监听分辨率选择变化
        if (this.composeResolutionSelect) {
            this.composeResolutionSelect.addEventListener('change', (e) => {
                this.updateResolutionSettings(e.target.value);
            });
        }

        // 监听宽高比处理变化
        if (this.composeAspectSelect) {
            this.composeAspectSelect.addEventListener('change', (e) => {
                this.updateAspectRatioSettings(e.target.value);
            });
        }

        // 监听质量预设变化
        if (this.composeQualitySelect) {
            this.composeQualitySelect.addEventListener('change', (e) => {
                this.updateQualitySettings(e.target.value);
            });
        }

        // 监听片头替换选项变化
        this.replaceIntroRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.updateIntroSettings(e.target.value === 'yes');
            });
        });

        // 监听片尾替换选项变化  
        this.replaceOutroRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.updateOutroSettings(e.target.value === 'yes');
            });
        });

        // 片头文件选择
        if (this.selectIntroBtn) {
            this.selectIntroBtn.addEventListener('click', () => this.selectIntroFile());
        }

        // 片尾文件选择
        if (this.selectOutroBtn) {
            this.selectOutroBtn.addEventListener('click', () => this.selectOutroFile());
        }

        // 监听片头片尾时长输入变化
        const introTrimInput = document.getElementById('intro-trim-seconds');
        const outroTrimInput = document.getElementById('outro-trim-seconds');
        const qualitySelect = document.getElementById('intro-outro-quality');
        
        if (introTrimInput) {
            introTrimInput.addEventListener('input', () => this.updateTrimSummary());
        }
        
        if (outroTrimInput) {
            outroTrimInput.addEventListener('input', () => this.updateTrimSummary());
        }
        
        if (qualitySelect) {
            qualitySelect.addEventListener('change', () => this.updateTrimSummary());
        }

        // 同步表头和文件列表的水平滚动
        this.fileList.addEventListener('scroll', () => {
            const header = document.querySelector('.file-list-header');
            if (header) {
                header.scrollLeft = this.fileList.scrollLeft;
            }
        });
        
        // 初始化裁剪汇总显示
        setTimeout(() => {
            this.updateTrimSummary();
        }, 100);
    }

    async checkFFmpegStatus() {
        try {
            const result = await ipcRenderer.invoke('check-ffmpeg');
            const indicator = this.ffmpegStatus.querySelector('.status-indicator');
            const text = this.ffmpegStatus.querySelector('span:last-child');
            
            if (result.success && result.available) {
                indicator.textContent = '✅';
                text.textContent = 'FFmpeg已就绪';
            } else {
                indicator.textContent = '❌';
                text.textContent = 'FFmpeg未安装或不可用';
                this.addLog('error', '❌ FFmpeg未安装，请先安装FFmpeg才能使用音视频处理功能');
            }
        } catch (error) {
            this.addLog('error', `检查FFmpeg状态失败: ${error.message}`);
        }
    }

    async selectFolder() {
        try {
            const result = await ipcRenderer.invoke('select-folder');
            if (result.success && result.path) {
                this.currentFolder = result.path;
                this.folderPath.textContent = `当前文件夹: ${result.path}`;
                this.addLog('info', `📂 选择文件夹: ${result.path}`);
                
                // 设置默认输出路径为源文件夹下的output文件夹
                const defaultOutputPath = await ipcRenderer.invoke('get-default-output-path', result.path);
                if (defaultOutputPath.success) {
                    this.outputFolder.value = defaultOutputPath.path;
                    this.addLog('info', `📁 默认输出路径: ${defaultOutputPath.path}`);
                }
                
                await this.scanMediaFiles();
            }
        } catch (error) {
            this.addLog('error', `选择文件夹失败: ${error.message}`);
        }
    }

    async selectOutputFolder() {
        try {
            const result = await ipcRenderer.invoke('select-folder');
            if (result.success && result.path) {
                this.outputFolder.value = result.path;
                this.addLog('info', `📁 输出文件夹: ${result.path}`);
            }
        } catch (error) {
            this.addLog('error', `选择输出文件夹失败: ${error.message}`);
        }
    }

    async scanMediaFiles() {
        if (!this.currentFolder) return;
        
        try {
            this.addLog('info', '🔍 正在扫描媒体文件...');
            const result = await ipcRenderer.invoke('scan-media-files', this.currentFolder);
            
            if (result.success) {
                this.mediaFiles = result.files;
                this.updateFileList();
                this.addLog('success', `✅ 扫描完成: 找到 ${this.mediaFiles.mp3.length} 个MP3文件, ${this.mediaFiles.video.length} 个视频文件`);
            } else {
                this.addLog('error', `扫描失败: ${result.error}`);
            }
        } catch (error) {
            this.addLog('error', `扫描文件时出错: ${error.message}`);
        }
    }

    switchFileTab(type) {
        this.currentFileType = type;
        
        // 更新标签页状态
        this.fileTabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.type === type);
        });
        
        // 更新配置面板
        this.updateConfigPanel(type);
        
        // 如果是合成视频标签页，初始化合成设置显示状态
        if (type === 'compose') {
            if (this.composeTypeSelect) {
                this.updateComposeSettings(this.composeTypeSelect.value);
            }
            if (this.composeResolutionSelect) {
                this.updateResolutionSettings(this.composeResolutionSelect.value);
            }
            if (this.composeAspectSelect) {
                this.updateAspectRatioSettings(this.composeAspectSelect.value);
            }
            if (this.composeQualitySelect) {
                this.updateQualitySettings(this.composeQualitySelect.value);
            }
        }
        
        // 如果是片头片尾处理标签页，初始化裁剪汇总显示
        if (type === 'intro-outro') {
            // 延迟调用以确保DOM元素已经加载
            setTimeout(() => {
                this.updateTrimSummary();
            }, 100);
        }
        
        // 控制拖拽提示显示（只在合成模式下显示）
        if (this.composeTip) {
            if (type === 'compose') {
                this.composeTip.style.display = 'block';
            } else {
                this.composeTip.style.display = 'none';
            }
        }
        
        // 控制序号列显示（只在合成模式下显示）
        const headerOrder = document.querySelector('.header-order');
        if (headerOrder) {
            if (type === 'compose') {
                headerOrder.style.display = 'flex';
            } else {
                headerOrder.style.display = 'none';
            }
        }
        
        // 检查是否需要获取详细信息
        const files = (type === 'compose' || type === 'intro-outro') ? 
            this.mediaFiles.video : 
            this.mediaFiles[type] || [];
        const needsDetails = files.some(file => 
            !file.info || file.info === '点击处理时获取详情'
        );
        
        this.renderFileList(needsDetails);
    }

    updateConfigPanel(type) {
        // 更新配置标题
        if (type === 'mp3') {
            this.configTitle.textContent = 'MP3压缩配置';
        } else if (type === 'video') {
            this.configTitle.textContent = '视频处理配置';
        } else if (type === 'compose') {
            this.configTitle.textContent = '视频合成配置';
        } else if (type === 'intro-outro') {
            this.configTitle.textContent = '视频片头片尾处理配置';
        }
        
        // 更新配置内容
        this.tabContents.forEach(content => {
            content.classList.toggle('active', content.id === `${type}-settings`);
        });
    }

    updateFileList() {
        this.renderFileList(true); // 首次渲染需要获取详细信息
    }

    renderFileList(loadDetails = false) {
        // 合成视频模式和片头片尾处理模式使用video文件列表
        const files = (this.currentFileType === 'compose' || this.currentFileType === 'intro-outro') ? 
            this.mediaFiles.video : 
            this.mediaFiles[this.currentFileType] || [];
        this.selectedFiles = [];
        
        if (files.length === 0) {
            this.fileList.innerHTML = `
                <div class="empty-state">
                    <p>未找到${this.getFileTypeName()}文件</p>
                </div>
            `;
            this.updateFileCount();
            return;
        }

        const fileItems = files.map((file, index) => {
            const fileName = file.name;
            const filePath = file.path;
            const fileSize = this.formatFileSize(file.size);
            const fileInfo = file.info || '';
            
            // 使用绝对路径显示
            const displayPath = filePath;
            
            // 如果已经有信息，直接使用；否则显示加载状态
            const infoDisplay = fileInfo && fileInfo !== '点击处理时获取详情' 
                ? fileInfo 
                : (loadDetails ? '<span class="loading-spinner"></span>正在获取信息...' : '点击处理时获取详情');
            
            return `
                <div class="file-item ${this.currentFileType}" data-index="${index}" data-type="${this.currentFileType}" ${this.currentFileType === 'compose' ? 'draggable="true"' : ''}>
                    ${this.currentFileType === 'compose' ? '<div class="drag-handle" title="拖拽排序">⋮⋮</div>' : ''}
                    <div class="file-order" style="display: ${this.currentFileType === 'compose' ? 'flex' : 'none'};">
                        <span class="order-number">${index + 1}</span>
                    </div>
                    <div class="file-select">
                        <input type="checkbox" data-index="${index}">
                    </div>
                    <div class="file-name" title="${filePath}">
                        <div class="file-name-text">${fileName}</div>
                        <div class="file-path-text">${displayPath}</div>
                    </div>
                    <div class="file-info" data-file-index="${index}">
                        ${infoDisplay}
                    </div>
                    <div class="file-size">${fileSize}</div>
                </div>
            `;
        }).join('');

        this.fileList.innerHTML = fileItems;
        
        // 绑定复选框事件
        this.fileList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const index = parseInt(e.target.dataset.index);
                if (e.target.checked) {
                    this.selectedFiles.push(files[index]);
                } else {
                    const fileIndex = this.selectedFiles.findIndex(f => f.path === files[index].path);
                    if (fileIndex > -1) {
                        this.selectedFiles.splice(fileIndex, 1);
                    }
                }
                this.updateFileCount();
                this.updateSelectAllCheckbox();
            });
        });
        
        // 为视频合成模式添加拖拽排序功能（仅在非加载状态时启用）
        if (this.currentFileType === 'compose') {
            this.setupDragAndDrop();
        }
        
        this.updateFileCount();
        this.updateSelectAllCheckbox();
        
        // 检查是否需要水平滚动
        this.checkHorizontalScroll();
        
        // 只在需要时获取文件详细信息
        if (loadDetails) {
            this.loadFileDetails(files);
        } else {
            // 如果不需要加载详细信息，立即启用拖拽功能
            this.isLoadingFileDetails = false;
            this.updateDragDropState();
        }
    }

    async loadFileDetails(files) {
        // 设置加载状态
        this.isLoadingFileDetails = true;
        this.updateDragDropState();
        
        // 延迟1秒开始获取，避免界面卡顿
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 确定实际的文件类型：合成视频模式和片头片尾处理模式使用video类型
        const actualFileType = (this.currentFileType === 'compose' || this.currentFileType === 'intro-outro') ? 'video' : this.currentFileType;
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                const result = await ipcRenderer.invoke('get-file-details', {
                    filePath: file.path,
                    fileType: actualFileType  // 使用实际的文件类型
                });
                
                if (result.success) {
                    // 更新文件信息显示
                    const infoElement = this.fileList.querySelector(`[data-file-index="${i}"]`);
                    if (infoElement) {
                        infoElement.innerHTML = result.details.info;
                    }
                    
                    // 更新内存中的文件信息，使用正确的数组
                    if (this.mediaFiles[actualFileType] && this.mediaFiles[actualFileType][i]) {
                        this.mediaFiles[actualFileType][i].info = result.details.info;
                    }
                }
            } catch (error) {
                console.error(`获取文件 ${file.name} 信息失败:`, error);
                const infoElement = this.fileList.querySelector(`[data-file-index="${i}"]`);
                if (infoElement) {
                    infoElement.innerHTML = '获取信息失败';
                }
            }
            
            // 每个文件之间间隔200ms，避免过度占用资源
            if (i < files.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
        
        // 完成加载，启用拖拽功能
        this.isLoadingFileDetails = false;
        this.updateDragDropState();
    }

    updateDragDropState() {
        if (this.currentFileType !== 'compose') {
            return; // 只有合成模式才需要拖拽功能
        }
        
        const fileItems = this.fileList.querySelectorAll('.file-item');
        const composeTip = document.querySelector('.compose-tip');
        
        console.log('updateDragDropState called:', {
            isLoadingFileDetails: this.isLoadingFileDetails,
            fileItemsCount: fileItems.length,
            currentFileType: this.currentFileType
        });
        
        if (this.isLoadingFileDetails) {
            // 禁用拖拽功能
            this.dragDropEnabled = false;
            fileItems.forEach(item => {
                item.draggable = false;
                item.classList.add('loading-disabled');
            });
            
            // 更新提示文字
            if (composeTip) {
                composeTip.innerHTML = `
                    <div class="compose-tip-content">
                        <span class="loading-spinner"></span>
                        <span>正在加载视频信息，请稍候...</span>
                    </div>
                `;
            }
        } else {
            // 启用拖拽功能
            this.dragDropEnabled = true;
            let enabledCount = 0;
            fileItems.forEach(item => {
                console.log('Processing item:', {
                    datasetType: item.dataset.type,
                    classList: item.classList.toString(),
                    draggable: item.draggable
                });
                if (item.dataset.type === 'compose') {
                    item.draggable = true;
                    item.classList.remove('loading-disabled');
                    enabledCount++;
                }
            });
            console.log('Enabled drag for', enabledCount, 'items');
            
            // 恢复提示文字
            if (composeTip) {
                composeTip.innerHTML = `
                    <div class="compose-tip-content">
                        <span class="compose-tip-icon">⋮⋮</span>
                        <span>拖拽视频文件可调整合成顺序</span>
                    </div>
                `;
            }
        }
    }

    checkHorizontalScroll() {
        setTimeout(() => {
            const fileList = this.fileList;
            const hasScroll = fileList.scrollWidth > fileList.clientWidth;
            
            if (hasScroll) {
                fileList.classList.add('has-horizontal-scroll');
            } else {
                fileList.classList.remove('has-horizontal-scroll');
            }
        }, 100);
    }

    selectAllFiles(checked) {
        // 确定实际的文件类型：合成视频模式和片头片尾处理模式使用video类型
        const actualFileType = (this.currentFileType === 'compose' || this.currentFileType === 'intro-outro') ? 'video' : this.currentFileType;
        const files = this.mediaFiles[actualFileType] || [];
        const checkboxes = this.fileList.querySelectorAll('input[type="checkbox"]');
        
        checkboxes.forEach(checkbox => {
            checkbox.checked = checked;
        });
        
        this.selectedFiles = checked ? [...files] : [];
        this.updateFileCount();
    }

    removeSelectedFiles() {
        if (this.selectedFiles.length === 0) return;
        
        const removedCount = this.selectedFiles.length;
        const fileType = this.currentFileType;
        // 确定实际的文件类型：合成视频模式和片头片尾处理模式使用video类型
        const actualFileType = (this.currentFileType === 'compose' || this.currentFileType === 'intro-outro') ? 'video' : this.currentFileType;
        
        // 从mediaFiles中移除选中的文件
        this.selectedFiles.forEach(selectedFile => {
            const index = this.mediaFiles[actualFileType].findIndex(file => file.path === selectedFile.path);
            if (index > -1) {
                this.mediaFiles[actualFileType].splice(index, 1);
            }
        });
        
        // 清空选中列表
        this.selectedFiles = [];
        
        // 重新渲染文件列表（不重新获取文件信息）
        this.renderFileList(false);
        
        // 记录日志
        const fileTypeName = fileType === 'mp3' ? 'MP3' : (fileType === 'compose' || fileType === 'intro-outro' ? '视频' : '视频');
        this.addLog('info', `🗑️ 已移除 ${removedCount} 个${fileTypeName}文件`);
    }

    updateSelectAllCheckbox() {
        // 确定实际的文件类型：合成视频模式和片头片尾处理模式使用video类型
        const actualFileType = (this.currentFileType === 'compose' || this.currentFileType === 'intro-outro') ? 'video' : this.currentFileType;
        const files = this.mediaFiles[actualFileType] || [];
        const checkedCount = this.selectedFiles.length;
        
        if (checkedCount === 0) {
            this.selectAllCheckbox.checked = false;
            this.selectAllCheckbox.indeterminate = false;
        } else if (checkedCount === files.length) {
            this.selectAllCheckbox.checked = true;
            this.selectAllCheckbox.indeterminate = false;
        } else {
            this.selectAllCheckbox.checked = false;
            this.selectAllCheckbox.indeterminate = true;
        }
    }

    updateFileCount() {
        const selectedCount = this.selectedFiles.length;
        // 确定实际的文件类型：合成视频模式和片头片尾处理模式使用video类型
        const actualFileType = (this.currentFileType === 'compose' || this.currentFileType === 'intro-outro') ? 'video' : this.currentFileType;
        const totalCount = this.mediaFiles[actualFileType]?.length || 0;
        
        if (selectedCount === 0) {
            this.fileCountText.textContent = `共 ${totalCount} 个文件`;
            this.processBtn.disabled = true;
            this.removeSelectedBtn.disabled = true;
        } else {
            this.fileCountText.textContent = `已选择 ${selectedCount} / ${totalCount} 个文件`;
            this.processBtn.disabled = false;
            this.removeSelectedBtn.disabled = false;
        }
    }

    async startProcessing() {
        if (this.isProcessing || this.selectedFiles.length === 0) return;

        // 检查是否设置了输出路径
        if (!this.outputFolder.value) {
            this.addLog('error', '❌ 请先设置输出文件夹');
            return;
        }
        
        this.isProcessing = true;
        this.processBtn.disabled = true;
        this.removeSelectedBtn.disabled = true;
        this.processBtn.textContent = '⏳ 处理中...';
        
        // 启动模拟进度
        this.startSimulatedProgress('analyzing', '正在分析文件...');
        
        try {
            if (this.currentFileType === 'mp3') {
                await this.processMp3Files();
            } else if (this.currentFileType === 'video') {
                await this.processVideoFiles();
            } else if (this.currentFileType === 'compose') {
                await this.composeVideos();
            } else if (this.currentFileType === 'intro-outro') {
                await this.processIntroOutroVideos();
            }
        } catch (error) {
            this.addLog('error', `处理失败: ${error.message}`);
        } finally {
            this.isProcessing = false;
            this.processBtn.textContent = '🚀 开始处理';
            this.updateFileCount(); // 恢复按钮状态
            
            // 显示完成状态，然后重置
            this.updateProgress({ type: this.currentFileType, current: 1, total: 1, status: 'complete' });
            setTimeout(() => {
                this.updateProgress({ type: this.currentFileType, current: 0, total: 0, status: 'idle' });
            }, 2000);
        }
    }

    async processMp3Files() {
        const options = {
            bitrate: parseInt(document.getElementById('mp3-bitrate').value),
            encodingMode: document.querySelector('input[name="encoding-mode"]:checked').value,
            threshold: parseInt(document.getElementById('mp3-threshold').value),
            keepStructure: document.getElementById('mp3-keep-structure').checked,
            forceProcess: document.querySelector('input[name="force-process"]:checked').value === 'yes'
        };

        this.addLog('info', `🎵 开始处理 ${this.selectedFiles.length} 个MP3文件`);
        this.addLog('info', `⚙️ 目标比特率: ${options.bitrate}kbps, 阈值: ${options.threshold}kbps`);
        if (options.forceProcess) {
            this.addLog('info', `💪 强制处理模式：将处理所有文件，忽略比特率阈值`);
        }

        const result = await ipcRenderer.invoke('process-mp3-files', {
            folderPath: this.currentFolder,
            outputPath: this.outputFolder.value,
            files: this.selectedFiles,
            options
        });

        if (result.success) {
            const { processed, skipped, failed, details } = result.result;
            this.addLog('success', `✅ MP3处理完成: 成功 ${processed}, 跳过 ${skipped}, 失败 ${failed}`);
            
            // 显示详细的处理结果
            details.forEach(detail => {
                if (detail.status === 'skipped') {
                    this.addLog('warning', `⏭️ ${detail.file}: ${detail.message}`);
                } else if (detail.status === 'error') {
                    this.addLog('error', `❌ ${detail.file}: ${detail.message}`);
                } else if (detail.status === 'success') {
                    this.addLog('info', `✅ ${detail.file}: ${detail.message}`);
                }
            });
        } else {
            this.addLog('error', `MP3处理失败: ${result.error}`);
        }
    }

    async processVideoFiles() {
        const options = {
            lessonName: document.getElementById('lesson-name').value || 'lesson',
            resolution: document.getElementById('video-resolution').value,
            bitrate: parseInt(document.getElementById('video-bitrate').value),
            segmentDuration: parseInt(document.getElementById('segment-duration').value),
            rename: document.getElementById('video-rename').checked
        };

        this.addLog('info', `🎬 开始处理 ${this.selectedFiles.length} 个视频文件`);
        this.addLog('info', `⚙️ 课程: ${options.lessonName}, 分辨率: ${options.resolution}, 比特率: ${options.bitrate}k`);

        const result = await ipcRenderer.invoke('process-video-files', {
            folderPath: this.currentFolder,
            outputPath: this.outputFolder.value,
            files: this.selectedFiles,
            options
        });

        if (result.success) {
            const { processed, failed } = result.result;
            this.addLog('success', `✅ 视频处理完成: 成功 ${processed}, 失败 ${failed}`);
        } else {
            this.addLog('error', `视频处理失败: ${result.error}`);
        }
    }

    // 启动模拟进度动画
    startSimulatedProgress(status = 'processing', message = '正在处理...') {
        this.stopSimulatedProgress();
        
        // 设置不同阶段的速度
        const speedConfig = {
            'analyzing': { speed: 0.3, maxProgress: 15, label: '正在分析' },
            'preprocessing': { speed: 0.2, maxProgress: 85, label: '预处理中' },
            'processing': { speed: 0.1, maxProgress: 95, label: '正在处理' },
            'composing': { speed: 0.15, maxProgress: 90, label: '正在合成' }
        };
        
        const config = speedConfig[status] || speedConfig.processing;
        this.progressSpeed = config.speed;
        this.maxSimulatedProgress = config.maxProgress;
        this.currentStatusLabel = config.label;
        
        this.isRealProgress = false;
        
        // 设置类名和显示
        this.progressFill.className = 'progress-fill';
        this.progressText.className = 'progress-text';
        this.progressSpinner.className = 'progress-spinner';
        
        if (status === 'preprocessing') {
            this.progressFill.classList.add('preprocessing');
            this.progressText.classList.add('preprocessing');
            this.progressSpinner.classList.add('visible', 'preprocessing');
        } else {
            this.progressFill.classList.add('processing');
            this.progressText.classList.add('processing');
            this.progressSpinner.classList.add('visible');
        }
        
        this.progressText.textContent = message;
        
        // 启动动画
        this.progressAnimationId = setInterval(() => {
            this.animateProgress();
        }, 100);
    }
    
    // 停止模拟进度
    stopSimulatedProgress() {
        if (this.progressAnimationId) {
            clearInterval(this.progressAnimationId);
            this.progressAnimationId = null;
        }
    }
    
    // 进度动画函数
    animateProgress() {
        if (this.isRealProgress) return;
        
        // 缓慢增加进度，但不超过最大值
        if (this.simulatedProgress < this.maxSimulatedProgress) {
            // 进度越高速度越慢（模拟真实情况）
            const slowdownFactor = Math.max(0.1, 1 - (this.simulatedProgress / this.maxSimulatedProgress) * 0.8);
            this.simulatedProgress += this.progressSpeed * slowdownFactor;
            
            this.progressFill.style.width = `${Math.min(this.simulatedProgress, this.maxSimulatedProgress)}%`;
        }
    }
    
    // 处理进度更新
    handleProgressUpdate(progress) {
        const { type, current, total, file, status, currentTime, totalDuration } = progress;
        
        // 如果是初始状态更新（analyzing、preprocessing开始、composing开始）
        if ((total <= 1 && current === 0) || (status === 'analyzing' || (status === 'preprocessing' && !currentTime) || (status === 'composing' && !currentTime))) {
            const statusMessages = {
                'analyzing': '正在分析视频信息...',
                'preprocessing': '正在预处理视频...',
                'composing': '正在合成视频...'
            };
            
            const message = statusMessages[status] || file || '正在处理...';
            this.startSimulatedProgress(status, message);
        } else if (total === 100 && current >= 0) {
            // FFmpeg真实进度（百分比）
            this.updateProgress(progress);
        } else {
            // 其他进度情况（如文件计数）
            this.updateProgress(progress);
        }
    }
    
    updateProgress(progress) {
        const { type, current, total, file, status } = progress;
        
        if (total > 0) {
            const realPercentage = Math.round((current / total) * 100);
            
            // 切换到真实进度
            this.isRealProgress = true;
            this.stopSimulatedProgress();
            
            // 确保进度不倒退
            const finalPercentage = Math.max(realPercentage, this.lastRealProgress);
            this.lastRealProgress = finalPercentage;
            
            this.progressFill.style.width = `${finalPercentage}%`;
            
            // 清除所有状态类
            this.progressFill.className = 'progress-fill';
            this.progressText.className = 'progress-text';
            this.progressSpinner.className = 'progress-spinner';
            
            if (status === 'processing') {
                this.progressFill.classList.add('processing');
                this.progressText.classList.add('processing');
                this.progressSpinner.classList.add('visible');
                this.progressText.textContent = `正在处理 (${current}/${total}): ${file}`;
                
            } else if (status === 'preprocessing') {
                this.progressFill.classList.add('preprocessing');
                this.progressText.classList.add('preprocessing');
                this.progressSpinner.classList.add('visible', 'preprocessing');
                this.progressText.textContent = `预处理中 (${current}/${total}): ${file}`;
                
            } else if (status === 'converting') {
                this.progressFill.classList.add('converting');
                this.progressText.classList.add('converting');
                this.progressSpinner.classList.add('visible', 'converting');
                this.progressText.textContent = `TS转换中 (${current}/${total}): ${file}`;
                
            } else if (status === 'complete') {
                this.stopSimulatedProgress();
                this.progressText.classList.add('complete');
                this.progressText.textContent = `处理完成`;
                this.progressFill.style.width = '100%';
                
                setTimeout(() => {
                    this.progressSpinner.classList.remove('visible');
                }, 1000);
            }
        } else {
            // 重置状态
            this.stopSimulatedProgress();
            this.simulatedProgress = 0;
            this.lastRealProgress = 0;
            this.isRealProgress = false;
            
            this.progressFill.className = 'progress-fill';
            this.progressText.className = 'progress-text';
            this.progressSpinner.className = 'progress-spinner';
            
            this.progressFill.style.width = '0%';
            this.progressText.textContent = '准备就绪';
            this.progressSpinner.classList.remove('visible');
        }
    }

    addLog(type, message) {
        const logEntry = document.createElement('p');
        logEntry.className = `log-entry ${type}`;
        logEntry.textContent = `${new Date().toLocaleTimeString()} ${message}`;
        
        this.logContent.appendChild(logEntry);
        this.logContent.scrollTop = this.logContent.scrollHeight;
    }

    async composeVideos() {
        // 验证选择的视频数量
        const composeType = document.getElementById('compose-type').value;
        if ((composeType === 'sidebyside' || composeType === 'pip') && this.selectedFiles.length !== 2) {
            this.addLog('error', `❌ ${composeType === 'sidebyside' ? '并排显示' : '画中画'}模式需要选择恰好2个视频文件`);
            return;
        }
        
        if (composeType === 'concat' && this.selectedFiles.length < 2) {
            this.addLog('error', '❌ 顺序拼接模式至少需要选择2个视频文件');
            return;
        }

        // 获取分辨率设置
        const resolutionSetting = document.getElementById('compose-resolution').value;
        let resolution = resolutionSetting;
        
        // 如果选择了自定义分辨率，获取自定义宽高值
        if (resolutionSetting === 'custom') {
            const customWidth = parseInt(document.getElementById('custom-width').value);
            const customHeight = parseInt(document.getElementById('custom-height').value);
            
            // 验证自定义分辨率输入
            if (!customWidth || !customHeight || customWidth < 320 || customHeight < 240) {
                this.addLog('error', '❌ 请输入有效的自定义分辨率（宽度≥320，高度≥240）');
                return;
            }
            
            resolution = {
                type: 'custom',
                width: customWidth,
                height: customHeight
            };
        }

        // 获取质量设置
        const qualityPreset = document.getElementById('compose-quality').value;
        let qualitySettings = { preset: qualityPreset };
        
        // 如果选择了自定义质量，获取详细参数
        if (qualityPreset === 'custom') {
            qualitySettings = {
                preset: 'custom',
                videoProfile: document.getElementById('video-profile').value,
                videoBitrate: parseInt(document.getElementById('video-bitrate-custom').value),
                videoFramerate: parseInt(document.getElementById('video-framerate-custom').value),
                audioBitrate: parseInt(document.getElementById('audio-bitrate-custom').value),
                audioSamplerate: parseInt(document.getElementById('audio-samplerate').value),
                encodePreset: document.getElementById('encode-preset').value
            };
        }

        // 获取用户设置的选项
        const options = {
            composeType: composeType,
            format: document.getElementById('compose-format').value,
            quality: qualitySettings,
            resolution: resolution,
            aspectRatio: document.getElementById('compose-aspect').value,
            background: document.getElementById('compose-background').value
        };

        // 根据合成类型获取特定选项
        if (composeType === 'concat') {
            options.transition = document.getElementById('compose-transition').value;
            options.audioMode = document.getElementById('compose-audio-concat').value;
        } else {
            options.audioMode = document.getElementById('compose-audio-multi').value;
            if (composeType === 'pip') {
                options.pipPosition = document.getElementById('compose-pip-position').value;
                options.pipSize = document.getElementById('compose-pip-size').value;
            }
        }

        this.addLog('info', `🎭 开始合成 ${this.selectedFiles.length} 个视频文件`);
        
        // 显示质量信息
        let qualityInfo;
        if (options.quality.preset === 'custom') {
            qualityInfo = `自定义 (${options.quality.videoBitrate}k, ${options.quality.videoFramerate}fps, ${options.quality.encodePreset})`;
        } else {
            const qualityNames = {
                'high': '高质量',
                'medium': '平衡',
                'fast': '快速'
            };
            qualityInfo = qualityNames[options.quality.preset] || options.quality.preset;
        }
        
        this.addLog('info', `⚙️ 合成类型: ${this.getComposeTypeName(options.composeType)}, 质量: ${qualityInfo}`);
        
        // 显示分辨率信息
        let resolutionInfo;
        if (typeof options.resolution === 'object' && options.resolution.type === 'custom') {
            resolutionInfo = `${options.resolution.width}x${options.resolution.height} (自定义)`;
        } else {
            const resolutionNames = {
                'auto': '自动',
                '4k': '4K (3840x2160)',
                '2k': '2K (2560x1440)', 
                '1080p': '1080p (1920x1080)',
                '720p': '720p (1280x720)',
                '480p': '480p (854x480)'
            };
            resolutionInfo = resolutionNames[options.resolution] || options.resolution;
        }
        
        this.addLog('info', `📐 分辨率: ${resolutionInfo}, 格式: ${options.format.toUpperCase()}`);
        this.addLog('info', `📝 输出文件: ${options.filename}.${options.format}`);

        const result = await ipcRenderer.invoke('compose-videos', {
            outputPath: this.outputFolder.value,
            files: this.selectedFiles,
            options
        });

        if (result.success) {
            const { processed, failed } = result.result;
            this.addLog('success', `✅ 视频合成完成: 成功 ${processed}, 失败 ${failed}`);
        } else {
            this.addLog('error', `视频合成失败: ${result.error}`);
        }
    }

    async processIntroOutroVideos() {
        // 获取片头片尾处理设置
        const replaceIntro = document.querySelector('input[name="replace-intro"]:checked').value === 'yes';
        const replaceOutro = document.querySelector('input[name="replace-outro"]:checked').value === 'yes';
        const introTrimSeconds = parseFloat(document.getElementById('intro-trim-seconds').value) || 0;
        const outroTrimSeconds = parseFloat(document.getElementById('outro-trim-seconds').value) || 0;
        const introFile = document.getElementById('intro-file').value;
        const outroFile = document.getElementById('outro-file').value;
        // 移除自定义文件名，将在处理器中自动生成文件夹名
        const quality = document.getElementById('intro-outro-quality').value || 'medium';

        // 验证设置
        if (replaceIntro && !introFile) {
            this.addLog('error', '❌ 请选择片头视频文件');
            return;
        }
        
        if (replaceOutro && !outroFile) {
            this.addLog('error', '❌ 请选择片尾视频文件');
            return;
        }

        if (!replaceIntro && !replaceOutro && introTrimSeconds === 0 && outroTrimSeconds === 0) {
            this.addLog('error', '❌ 请至少启用一种处理选项（替换片头/片尾或裁剪时长）');
            return;
        }

        const options = {
            replaceIntro,
            replaceOutro,
            introFile,
            outroFile,
            introTrimSeconds,
            outroTrimSeconds,
            quality
        };

        this.addLog('info', `🎬 开始处理 ${this.selectedFiles.length} 个视频文件`);
        this.addLog('info', `⚙️ 处理选项: 替换片头=${replaceIntro}, 替换片尾=${replaceOutro}, 质量=${quality}`);
        
        if (introTrimSeconds > 0) {
            this.addLog('info', `✂️ 裁剪片头: ${introTrimSeconds}秒`);
        }
        if (outroTrimSeconds > 0) {
            this.addLog('info', `✂️ 裁剪片尾: ${outroTrimSeconds}秒`);
        }
        if (replaceIntro && introFile) {
            this.addLog('info', `🎬 新片头: ${path.basename(introFile)}`);
        }
        if (replaceOutro && outroFile) {
            this.addLog('info', `🎭 新片尾: ${path.basename(outroFile)}`);
        }

        const result = await ipcRenderer.invoke('process-intro-outro', {
            outputPath: this.outputFolder.value,
            files: this.selectedFiles,
            options
        });

        if (result.success) {
            this.addLog('success', `✅ 视频片头片尾处理完成`);
        } else {
            this.addLog('error', `视频片头片尾处理失败: ${result.error}`);
        }
    }

    getComposeTypeName(type) {
        const typeNames = {
            'concat': '顺序拼接',
            'sidebyside': '并排显示',
            'pip': '画中画'
        };
        return typeNames[type] || type;
    }

    getFileTypeName() {
        const typeNames = {
            'mp3': 'MP3',
            'video': '视频',
            'compose': '视频',
            'intro-outro': '视频'
        };
        return typeNames[this.currentFileType] || '文件';
    }

    updateComposeSettings(composeType) {
        if (!this.concatSettings || !this.multiVideoSettings) return;
        
        if (composeType === 'concat') {
            // 顺序拼接：显示拼接设置，隐藏多视频设置
            this.concatSettings.style.display = 'block';
            this.multiVideoSettings.style.display = 'none';
        } else {
            // 并排显示或画中画：显示多视频设置，隐藏拼接设置
            this.concatSettings.style.display = 'none';
            this.multiVideoSettings.style.display = 'block';
            
            // 画中画需要额外显示位置和大小设置
            if (composeType === 'pip') {
                if (this.pipPositionGroup) this.pipPositionGroup.style.display = 'block';
                if (this.pipSizeGroup) this.pipSizeGroup.style.display = 'block';
            } else {
                if (this.pipPositionGroup) this.pipPositionGroup.style.display = 'none';
                if (this.pipSizeGroup) this.pipSizeGroup.style.display = 'none';
            }
        }
    }

    updateResolutionSettings(resolution) {
        if (!this.customResolutionGroup) return;
        
        if (resolution === 'custom') {
            // 显示自定义分辨率输入框
            this.customResolutionGroup.style.display = 'block';
        } else {
            // 隐藏自定义分辨率输入框
            this.customResolutionGroup.style.display = 'none';
        }
    }

    updateAspectRatioSettings(aspectRatio) {
        if (!this.backgroundColorGroup) return;
        
        if (aspectRatio === 'pad') {
            // 保持比例，黑边填充 - 显示背景颜色选项
            this.backgroundColorGroup.style.display = 'block';
        } else {
            // 裁剪或拉伸 - 隐藏背景颜色选项
            this.backgroundColorGroup.style.display = 'none';
        }
    }

    updateQualitySettings(quality) {
        if (!this.customQualityGroup) return;
        
        if (quality === 'custom') {
            // 自定义质量 - 显示详细参数设置
            this.customQualityGroup.style.display = 'block';
        } else {
            // 预设质量 - 隐藏详细参数设置
            this.customQualityGroup.style.display = 'none';
        }
    }

    setupDragAndDrop() {
        let draggedElement = null;
        let draggedIndex = null;
        
        // 选择所有compose类型的文件项，而不仅仅是当前可拖拽的
        const fileItems = this.fileList.querySelectorAll('.file-item.compose');
        
        fileItems.forEach((item, index) => {
            // 拖拽开始
            item.addEventListener('dragstart', (e) => {
                // 如果拖拽功能被禁用，阻止拖拽
                if (!this.dragDropEnabled) {
                    e.preventDefault();
                    return false;
                }
                
                draggedElement = item;
                draggedIndex = parseInt(item.dataset.index);
                item.classList.add('dragging');
                
                // 设置拖拽数据
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', item.outerHTML);
                
                // 创建自定义拖拽图像
                const dragImage = item.cloneNode(true);
                dragImage.style.transform = 'rotate(3deg)';
                dragImage.style.opacity = '0.8';
                document.body.appendChild(dragImage);
                e.dataTransfer.setDragImage(dragImage, 0, 0);
                setTimeout(() => document.body.removeChild(dragImage), 0);
            });
            
            // 拖拽结束
            item.addEventListener('dragend', (e) => {
                item.classList.remove('dragging');
                this.fileList.querySelectorAll('.file-item').forEach(el => {
                    el.classList.remove('drag-over-top', 'drag-over-bottom');
                });
                draggedElement = null;
                draggedIndex = null;
            });
            
            // 拖拽悬停
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                
                if (draggedElement && draggedElement !== item) {
                    const rect = item.getBoundingClientRect();
                    const midpoint = rect.top + rect.height / 2;
                    
                    // 清除之前的拖拽样式
                    item.classList.remove('drag-over-top', 'drag-over-bottom');
                    
                    // 根据鼠标位置决定插入位置
                    if (e.clientY < midpoint) {
                        item.classList.add('drag-over-top');
                    } else {
                        item.classList.add('drag-over-bottom');
                    }
                }
            });
            
            // 离开拖拽区域
            item.addEventListener('dragleave', (e) => {
                // 只有当真正离开元素时才移除样式
                if (!item.contains(e.relatedTarget)) {
                    item.classList.remove('drag-over-top', 'drag-over-bottom');
                }
            });
            
            // 放置
            item.addEventListener('drop', (e) => {
                e.preventDefault();
                
                if (draggedElement && draggedElement !== item) {
                    const targetIndex = parseInt(item.dataset.index);
                    const rect = item.getBoundingClientRect();
                    const midpoint = rect.top + rect.height / 2;
                    
                    // 确定插入位置
                    let insertIndex = targetIndex;
                    if (e.clientY >= midpoint) {
                        insertIndex = targetIndex + 1;
                    }
                    
                    // 调整索引（如果拖拽元素在目标之前）
                    if (draggedIndex < insertIndex) {
                        insertIndex--;
                    }
                    
                    // 执行重排序
                    this.reorderFiles(draggedIndex, insertIndex);
                }
                
                // 清除拖拽样式
                this.fileList.querySelectorAll('.file-item').forEach(el => {
                    el.classList.remove('drag-over-top', 'drag-over-bottom');
                });
            });
        });
    }
    
    reorderFiles(fromIndex, toIndex) {
        // 只有合成模式支持拖拽排序
        if (this.currentFileType !== 'compose') {
            return;
        }
        
        // 获取当前文件数组
        const files = this.mediaFiles.video || [];
        
        if (fromIndex < 0 || fromIndex >= files.length || 
            toIndex < 0 || toIndex > files.length || 
            fromIndex === toIndex) {
            return;
        }
        
        // 移动文件
        const [movedFile] = files.splice(fromIndex, 1);
        files.splice(toIndex, 0, movedFile);
        
        // 更新选中文件数组中的引用
        this.selectedFiles = this.selectedFiles.map(selectedFile => {
            const newIndex = files.findIndex(f => f.path === selectedFile.path);
            return newIndex !== -1 ? files[newIndex] : selectedFile;
        });
        
        // 重新渲染文件列表
        this.renderFileList(false);
        
        // 更新序号显示
        this.updateOrderNumbers();
        
        // 显示排序提示
        if (this.addLog) {
            this.addLog('info', `📋 视频顺序已调整: ${movedFile.name} 移动到位置 ${toIndex + 1}`);
        }
    }
    
    updateOrderNumbers() {
        // 只在合成模式下更新序号
        if (this.currentFileType !== 'compose') return;
        
        const orderNumbers = this.fileList.querySelectorAll('.order-number');
        orderNumbers.forEach((orderElement, index) => {
            orderElement.textContent = index + 1;
            
            // 添加一个简单的动画效果
            orderElement.style.transform = 'scale(1.2)';
            setTimeout(() => {
                orderElement.style.transform = 'scale(1)';
            }, 200);
        });
    }

    // 更新片头设置显示状态
    updateIntroSettings(replaceIntro) {
        if (this.introFileGroup) {
            this.introFileGroup.style.display = replaceIntro ? '' : 'none';
        }
    }

    // 更新片尾设置显示状态
    updateOutroSettings(replaceOutro) {
        if (this.outroFileGroup) {
            this.outroFileGroup.style.display = replaceOutro ? '' : 'none';
        }
    }

    // 选择片头文件
    async selectIntroFile() {
        try {
            const result = await ipcRenderer.invoke('select-intro-file');
            if (result.success && result.filePath) {
                this.introFileInput.value = result.filePath;
            }
        } catch (error) {
            console.error('选择片头文件失败:', error);
            this.addLog('error', '选择片头文件失败: ' + error.message);
        }
    }

    // 选择片尾文件
    async selectOutroFile() {
        try {
            const result = await ipcRenderer.invoke('select-outro-file');
            if (result.success && result.filePath) {
                this.outroFileInput.value = result.filePath;
            }
        } catch (error) {
            console.error('选择片尾文件失败:', error);
            this.addLog('error', '选择片尾文件失败: ' + error.message);
        }
    }

    // 更新裁剪汇总显示
    updateTrimSummary() {
        const introTrimInput = document.getElementById('intro-trim-seconds');
        const outroTrimInput = document.getElementById('outro-trim-seconds');
        const introTrimDisplay = document.getElementById('intro-trim-display');
        const outroTrimDisplay = document.getElementById('outro-trim-display');
        const totalTrimDisplay = document.getElementById('total-trim-display');
        const qualitySelect = document.getElementById('intro-outro-quality');
        const precisionWarning = document.getElementById('precision-warning');
        
        if (!introTrimInput || !outroTrimInput || !introTrimDisplay || !outroTrimDisplay || !totalTrimDisplay) {
            return;
        }
        
        const introTrim = parseFloat(introTrimInput.value) || 0;
        const outroTrim = parseFloat(outroTrimInput.value) || 0;
        const totalTrim = introTrim + outroTrim;
        const quality = qualitySelect ? qualitySelect.value : 'copy';
        
        // 更新显示
        introTrimDisplay.textContent = introTrim > 0 ? `${introTrim}秒` : '0秒';
        outroTrimDisplay.textContent = outroTrim > 0 ? `${outroTrim}秒` : '0秒';
        totalTrimDisplay.textContent = totalTrim > 0 ? `${totalTrim}秒` : '0秒';
        
        // 如果总计大于0，高亮显示
        const totalItem = totalTrimDisplay.closest('.summary-item');
        if (totalItem) {
            if (totalTrim > 0) {
                totalItem.style.backgroundColor = '#fff3cd';
                totalItem.style.borderColor = '#ffeaa7';
                totalTrimDisplay.style.color = '#856404';
            } else {
                totalItem.style.backgroundColor = '';
                totalItem.style.borderColor = '';
                totalTrimDisplay.style.color = '';
            }
        }
        
        // 显示/隐藏精度警告（只有快速模式需要警告）
        if (precisionWarning) {
            if (totalTrim > 0 && quality === 'copy') {
                precisionWarning.style.display = 'flex';
            } else {
                precisionWarning.style.display = 'none';
            }
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new MediaProcessorApp();
}); 