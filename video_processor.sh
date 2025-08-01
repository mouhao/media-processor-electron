#!/bin/bash

#################################################################
## 作者：huanggh
## 创建时间:2023-10-20 19:48
## 描述：视频处理脚本
## 版本：v1.0
## 依赖：ffmpeg
## 语法：./video_processor.sh [OPTIONS]
## 参数：  ffmpeg_path=PATH            指定ffmpeg可执行文件的路径。
##        input_file=FILE             输入需要处理的视频文件路径。
##        output_path=PATH            输出视频文件路径。
##        logo_file=FILE              指定logo文件路径。
##        intro_720p_file=FILE        指定720p片头文件路径。
##        outro_720p_file=FILE        指定720p片尾文件路径。
##        intro_1080p_file=FILE       指定1080p片头文件路径。
##        outro_1080p_file=FILE       指定1080p片尾文件路径。
##        convert_to_m3u8=yes/no      是否将视频转换为m3u8格式。
##        add_logo=yes/no             是否将logo添加到视频中。
##        logo_scale=WIDTHxHEIGHT     设置logo的缩放大小。
##        logo_overlay=X:Y            设置logo的叠加位置。
##        add_intro_outro=yes/no      是否将片头和片尾添加到视频中。
##        trim_start=0                修剪视频的开始。单位：秒。
##        trim_end=0                  修剪视频的结尾。单位：秒。
##        delete_original=yes/no      是否删除原始文件input_file。
##        quiet=yes/no                是否抑制输出。 默认：是。
##        --help                      显示帮助信息。
## 功能：
## 1、验证参数的正确性。检查ffmpeg_path、logo_file、intro_720p_file、outro_720p_file是否指向有效的文件。否则退出。
## 2、检查是否提供了input_file参数。否则退出。
## 3、检查convert_to_m3u8、add_logo、add_intro_outro、trim_start、trim_end、quiet参数是否有效。否则退出。
## 4、获取视频的相关信息。比如视频的总时长、帧数等。
## 5、先对视频进行编码格式、长宽检查等，不符合要求，先进行预处理
## 6、根据参数，对视频进行处理。修剪、添加logo、添加片头片尾、转换为m3u8格式等。
#################################################################

# 添加帮助文档的函数
show_help() {
    echo 
    echo "===HELP==="
    echo "Usage: $0 [OPTIONS]"
    echo "for example: ./video_processor.sh ffmpeg_path=/home/ffmpeg/ffmpeg logo_file=/video_test/logo.png intro_720p_file=/video_test/head.ts outro_720p_file=/video_test/tail.ts  input_file=1.mp4 convert_to_m3u8=no add_logo=no add_intro_outro=no trim_start=0 trim_end=0 quiet=yes"
    echo
    echo "Available options:"
    echo "  --help                      Display this help message."
    echo "  ffmpeg_path=PATH            Specify the path to the ffmpeg executable."
    echo "  input_file=FILE             Specify the input video file."
    echo "  output_path=PATH            Specify the output video PATH."
    echo "  logo_file=FILE              Specify the logo file."
    echo "  intro_720p_file=FILE        Specify the 720p intro file."
    echo "  outro_720p_file=FILE        Specify the 720p outro file."
    echo "  intro_1080p_file=FILE       Specify the 1080p intro file."
    echo "  outro_1080p_file=FILE       Specify the 1080p outro file."
    echo "  convert_to_m3u8=yes/no      Convert video to m3u8 format."
    echo "  add_logo=yes/no             Add logo to the video."
    echo "  logo_scale=WIDTHxHEIGHT     Set the scaling dimensions for the logo."
    echo "  logo_overlay=X:Y            Set the overlay position of the logo on the video."
    echo "  add_intro_outro=yes/no      Add intro and outro to the video."
    echo "  trim_start=SECONDS          Trim the specified seconds from the start of the video."
    echo "  trim_end=SECONDS            Trim the specified seconds from the end of the video."
    echo "  delete_original=yes/no      Delete the original video file."
    echo "  quiet=yes/no                 Suppress ffmpeg output (default: yes)."
    echo
}

# 配置部分
TRIM_START=0  # 默认不去除片头
TRIM_END=0    # 默认不去除片尾
FFMPEG_LOGLEVEL=" -loglevel panic "  # 默认不打印ffmpeg的输出
LOGO_SCALE="196:196"  # 默认logo缩放尺寸
LOGO_OVERLAY="43:30"  # 默认logo叠加位置

# 解析 key=value 形式的参数
for arg in "$@"; do
    key=$(echo "$arg" | cut -f1 -d=)
    value=$(echo "$arg" | cut -f2 -d=)
    case $key in
        ffmpeg_path) FFMPEG_PATH=$value ;;
        input_file) INPUT_FILE=$value ;;
        output_path) OUTPUT_PATH=$value ;;
        logo_file) LOGO_FILE=$value ;;
        intro_720p_file) INTRO_720p_FILE=$value ;;
        outro_720p_file) OUTRO_720p_FILE=$value ;;
        intro_1080p_file) INTRO_1080p_FILE=$value ;;
        outro_1080p_file) OUTRO_1080p_FILE=$value ;;
        convert_to_m3u8) CONVERT_TO_M3U8=$value ;;
        add_logo) ADD_LOGO=$value ;;
        logo_scale) LOGO_SCALE=$value ;;
        logo_overlay) LOGO_OVERLAY=$value ;;
        add_intro_outro) ADD_INTRO_OUTRO=$value ;;
        quiet) QUIET=$value ;;
        trim_start) TRIM_START=$value ;;
        trim_end) TRIM_END=$value ;;
        delete_original) DELETE_ORIGINAL=$value ;;
        --help) show_help && exit 0 ;; # 新增的--help选项
        *)  echo -e "\033[31m ERROR: Param $key  is not supported . \033[0m" &&  show_help && exit 1 ;; # 遇到未知参数时显示帮助信息并退出
    esac
done


# 添加到终端的日志功能
log() {
    echo "$(date "+%Y-%m-%d %H:%M:%S")- $INPUT_FILE - $1"
}

# 检查命令执行是否成功
check_cmd_success() {
    if [ $? -ne 0 ]; then
        log "ERROR: $1"
        exit 1
    fi
}



# 验证参数的正确性

# 确保FFMPEG_PATH指向一个有效的ffmpeg可执行文件
if [ ! -x "$FFMPEG_PATH" ]; then
    echo
    echo -e "\033[31m ERROR: FFMPEG_PATH does not point to a valid ffmpeg executable. \033[0m"
    echo
    show_help
    exit 1
fi

# 确保INTRO_720p_FILE、OUTRO_720p_FILE和LOGO_FILE指向有效的文件
for file in "$INTRO_720p_FILE" "$OUTRO_720p_FILE" "$INTRO_1080p_FILE" "$OUTRO_1080p_FILE" "$LOGO_FILE"; do
    if [ ! -f "$file" ]; then
        echo
        echo -e "\033[31m ERROR: $file does not exist. \033[0m"
        echo
        show_help
        exit 1
    fi
done

# 检查是否提供了input_file参数
if [ -z $INPUT_FILE ]; then
    echo
    echo -e "\033[31m ERROR: input_file parameter is required. \033[0m"
    echo
    show_help
    exit 1
fi

# 检查是否提供了output_path参数
if [ -z $OUTPUT_PATH ]; then
    echo
    echo -e "\033[31m ERROR: output_path parameter is required. \033[0m"
    echo
    show_help
    exit 1
fi

# 检查output_path目录是否存在，如果不存在则创建
if [ ! -d $OUTPUT_PATH ]; then
    mkdir -p $OUTPUT_PATH
fi

# 检查 input_file 文件是否存在
if [ ! -f $INPUT_FILE ]; then
    echo
    echo -e "\033[31m ERROR: input_file does not exist. \033[0m"
    echo
    show_help
    exit 1
fi

# 检查convert_to_m3u8, add_logo, add_intro_outro, quiet参数的值是否为yes或no
for param in "$CONVERT_TO_M3U8" "$ADD_LOGO" "$ADD_INTRO_OUTRO" "$QUIET" "$DELETE_ORIGINAL"; do
    if [[ "$param" != "yes" && "$param" != "no" && -n "$param" ]]; then
        echo
        echo -e "\033[31m ERROR: Invalid value for parameter. Expected 'yes' or 'no'. \033[0m"
        echo
        show_help
        exit 1
    fi
done

# 检查trim_start和trim_end是否为数字
if ! [[ $TRIM_START =~ ^[0-9]+(\.[0-9]+)?$ ]] || ! [[ "$TRIM_END" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    echo
    echo -e "\033[31m ERROR: trim_start and trim_end parameters must be numeric (integer or decimal). \033[0m"
    echo
    show_help
    exit 1
fi


# 如果quiet参数为"no"，则显示ffmpeg的所有输出
if [ "$QUIET" == "no" ]; then
    FFMPEG_LOGLEVEL=" -loglevel info "
fi


FILEDIR=$(dirname $INPUT_FILE)
FILENAME=$(basename $INPUT_FILE)
FILENAME_WITHOUT_EXT="${FILENAME%.*}"

# 获取视频的相关信息
log "Start..."
# log "Getting video properties..."
CMD="$FFMPEG_PATH -i $INPUT_FILE"
# log "Executing: $CMD"
VIDEO_INFO=$(eval "$CMD" 2>&1)

# 获取视频的宽度
WIDTH=$(echo "$VIDEO_INFO" | grep 'Stream' | grep 'Video'  | sed -nE 's/.* ([0-9]+)x[0-9]+.*/\1/p')
# 获取视频的高度
HEIGHT=$(echo "$VIDEO_INFO" | grep 'Stream' | grep 'Video' | sed -nE 's/.* [0-9]+x([0-9]+).*/\1/p')
# 获取视频的比特率
BITRATE=$(echo "$VIDEO_INFO" | grep 'bitrate' | sed -nE 's/.*bitrate: ([0-9]+) kb\/s.*/\1/p')
# 获取视频编码格式
CODEC=$(echo "$VIDEO_INFO" | grep "Stream" | grep "Video" | sed -nE 's/.*Video: ([a-zA-Z0-9]+) .*/\1/p')
# 获取视频是否有音轨
HAS_AUDIO=$(echo "$VIDEO_INFO" | grep Audio)

# 获取总时长
get_video_duration() {
    local duration
    duration=$(echo "$VIDEO_INFO" | grep 'Duration' | cut -d ' ' -f 4 | sed s/,//)
    # local hours
    # hours=$(echo "$duration" | cut -d":" -f1)
    # local minutes
    # minutes=$(echo "$duration" | cut -d":" -f2)
    # local seconds
    # seconds=$(echo "$duration" | cut -d":" -f3 | cut -d"." -f1)

    # # 使用10#前缀来指定十进制，这样可以避免前导零导致的问题
    # echo $((10#$hours*3600 + 10#$minutes*60 + 10#$seconds))
    # duration=$(ffmpeg -i "$file" 2>&1 | grep "Duration" | cut -d ' ' -f 4 | sed s/,//)
    local total_seconds=$(echo $duration | awk -F: '{ print ($1 * 3600) + ($2 * 60) + $3 }')
    echo $total_seconds

}
TOTAL_SECONDS=$(get_video_duration)

# log "VIDEO WIDTH: $WIDTH"
# log "VIDEO HEIGHT: $HEIGHT"
# log "VIDEO BITRATE: $BITRATE"
# log "VIDEO CODEC: $CODEC"
# log "VIDEO TOTAL_SECONDS: $TOTAL_SECONDS"


# 检查宽度、高度和比特率是否为空
if [[ -z "$WIDTH" || -z "$HEIGHT" || -z "$BITRATE" || -z "$CODEC" || -z "$TOTAL_SECONDS" ]]; then
    echo
    echo -e "\033[31m ERROR: Failed to retrieve video properties (Width, Height, codec, total_seconds or Bitrate). \033[0m"
    echo
    exit 1
fi


# 配置变量
TEMP_FILE="$OUTPUT_PATH/temp_${FILENAME}"

# 初始备份输入文件
# log "Backing up input file..."
cp -r $INPUT_FILE $FILEDIR/processing_${FILENAME}
INTERMEDIATE_FILE=$FILEDIR/processing_${FILENAME}


calculate_duration_time() {
    local trim_start=$1
    local trim_end=$2
    local total_seconds
    local total_seconds=$TOTAL_SECONDS
    local end_cut=$(echo "$total_seconds - $trim_start - $trim_end" | bc)
    echo $end_cut
}


# 预处理，包括添加静音音轨和视频转码（如果需要）
if [ -z "$HAS_AUDIO" ] || [ "$CODEC" != "h264" ] || [ "$WIDTH" != 1920 ] || [ "$HEIGHT" != 1080 ]; then
    log "Preprocessing video for any required codec or format normalization..."
    if [ -z "$HAS_AUDIO" ]; then
        # 添加静音音轨
        ADD_AUDIO_CMD=" -f lavfi -t $TOTAL_SECONDS -i anullsrc=r=48000:cl=stereo -c:a aac -strict experimental "
    else
        ADD_AUDIO_CMD=""
    fi
    CONVERT_WIDTH_CMD=""
    CONVERT_CMD=""

    if [ "$WIDTH" != 1920 ] || [ "$HEIGHT" != 1080 ]; then
        CONVERT_WIDTH_CMD=" -c:v libx264 -vf scale=1920:1080 -b:v 8000k -profile:v main "
        WIDTH=1920
    else
        # 视频转码
        if [ "$CODEC" != "h264" ]; then
            CONVERT_CMD="-c:v libx264 -profile:v main"
        fi
    fi
    CMD="$FFMPEG_PATH $FFMPEG_LOGLEVEL -i $INTERMEDIATE_FILE $ADD_AUDIO_CMD -i $INTERMEDIATE_FILE $CONVERT_CMD $CONVERT_WIDTH_CMD -c:a copy -y $TEMP_FILE"
    log "Executing: ${CMD[*]}"
    eval "$CMD"
    check_cmd_success "Failed during preprocessing"
    cp -r $TEMP_FILE $INTERMEDIATE_FILE

fi

# 裁剪视频
if [[ $(echo "$TRIM_START > 0" | bc) -eq 1 || $(echo "$TRIM_END > 0" | bc) -eq 1 ]]; then
    log "Trimming the video..."
    DURATION_TIME=$(calculate_duration_time $TRIM_START $TRIM_END)
    CMD="$FFMPEG_PATH  $FFMPEG_LOGLEVEL  -ss $TRIM_START -t $DURATION_TIME -i $INTERMEDIATE_FILE -c copy -y $TEMP_FILE"
    log "Executing: ${CMD[*]}"
    eval "$CMD"
    
    check_cmd_success "Failed during trimming"
    cp -r $TEMP_FILE $INTERMEDIATE_FILE
fi

# 添加logo
if [ "$ADD_LOGO" = "yes" ]; then
    log "Adding logo to the video..."
    # CMD="$FFMPEG_PATH $FFMPEG_LOGLEVEL -hwaccel videotoolbox  -i $INTERMEDIATE_FILE -vf \"movie=$LOGO_FILE [logo]; [in][logo] overlay=50:50 [out]\" -c:a copy -y $TEMP_FILE"
    # /opt/homebrew/bin/ffmpeg -loglevel panic -hwaccel videotoolbox -i old/9玩趣科学实验室/processing_c_9_1_video.mp4 -i /Users/huanggh/Desktop/测试ffmpeg截图/加水印/ai/logo.png -filter_complex "[0:v]delogo=x=40:y=40:w=190:h=145[delogoed]; [delogoed][1:v]overlay=50:50[out]" -map "[out]" -map 0:a -c:v h264_videotoolbox -c:a copy -y new/9玩趣科学实验室/processor/temp_c_9_1_video.mp4
    # /opt/homebrew/bin/ffmpeg -i new/445给孩子的聊斋志异/processor/E01.mp4  -vf "movie=/Users/huanggh/Desktop/测试ffmpeg截图/加水印/ai/logo.png,scale=184:184[logo]; [in][logo] overlay=29:20[out]"  -c:a copy -y 445E01_logo.mp4
    # "movie=/Users/huanggh/Desktop/测试ffmpeg截图/加水印/ai/logo.png,scale=196:196[logo]; [in][logo] overlay=43:30[out]"
    CMD="$FFMPEG_PATH $FFMPEG_LOGLEVEL -hwaccel videotoolbox  -i $INTERMEDIATE_FILE -vf \"movie=$LOGO_FILE,scale=$LOGO_SCALE[logo]; [in][logo] overlay=$LOGO_OVERLAY[out]\" -c:v h264_videotoolbox -profile:v main -b:v 8000k -preset faster -y $TEMP_FILE"
  
    log "Executing: ${CMD[*]}"
    eval "$CMD"
    check_cmd_success "Failed to add logo"
    cp -r $TEMP_FILE $INTERMEDIATE_FILE
fi

# 添加片头片尾
if [ "$ADD_INTRO_OUTRO" = "yes" ]; then
    log "Adding intro and outro to the video..."
    if [[ $WIDTH -ge 1920 ]]; then
        INTRO_FILE=$INTRO_1080p_FILE
        OUTRO_FILE=$OUTRO_1080p_FILE
    else
        INTRO_FILE=$INTRO_720p_FILE
        OUTRO_FILE=$OUTRO_720p_FILE
    fi
    CMD="$FFMPEG_PATH $FFMPEG_LOGLEVEL -hwaccel videotoolbox  -i $INTRO_FILE -i $INTERMEDIATE_FILE -i $OUTRO_FILE -filter_complex \"[0:v]setsar=1/1,setdar=16/9[v0];[1:v]setsar=1/1,setdar=16/9[v1];[2:v]setsar=1/1,setdar=16/9[v2];[v0][0:a][v1][1:a][v2][2:a]concat=n=3:v=1:a=1[v][a]\" -map \"[v]\" -map \"[a]\" -c:v h264_videotoolbox -profile:v main -b:v 8000k -preset faster -y $TEMP_FILE"
    log "Executing: ${CMD[*]}"
    eval "$CMD"
    check_cmd_success "Failed to add intro and outro"
    cp -r $TEMP_FILE $INTERMEDIATE_FILE
fi


# 如果需要转为m3u8
if [ "$CONVERT_TO_M3U8" = "yes" ]; then
    log "Converting video to m3u8 format..."
    CMD=($FFMPEG_PATH $FFMPEG_LOGLEVEL -i $INTERMEDIATE_FILE -c:v libx264 -profile:v main -hls_time 15 -hls_list_size 0  -c:a aac -strict -2 -f hls -maxrate 3M -bufsize 6M  -y $OUTPUT_PATH/$FILENAME_WITHOUT_EXT.m3u8)
    log "Executing: ${CMD[*]}"
    eval "$CMD"
    check_cmd_success "Failed to convert to m3u8"
fi


# 删除temp文件
rm -rf $TEMP_FILE
# 最后的输出文件
# log "Finalizing video processing..."
mv $INTERMEDIATE_FILE $OUTPUT_PATH/$FILENAME
log "Processing finished!"
