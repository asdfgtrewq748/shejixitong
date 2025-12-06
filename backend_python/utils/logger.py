"""
日志配置模块 - 提供统一的日志记录功能
"""
import logging
import sys
from datetime import datetime
from pathlib import Path

def setup_logger(name: str = "mining_design", log_level: str = "INFO") -> logging.Logger:
    """
    设置并返回配置好的logger

    Args:
        name: logger名称
        log_level: 日志级别 (DEBUG, INFO, WARNING, ERROR, CRITICAL)

    Returns:
        配置好的logger实例
    """
    logger = logging.getLogger(name)

    # 避免重复添加handler
    if logger.handlers:
        return logger

    logger.setLevel(getattr(logging, log_level.upper(), logging.INFO))

    # 控制台处理器 - INFO及以上级别
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_format = logging.Formatter(
        '%(asctime)s | %(levelname)-8s | %(message)s',
        datefmt='%H:%M:%S'
    )
    console_handler.setFormatter(console_format)
    logger.addHandler(console_handler)

    # 文件处理器 - DEBUG及以上级别
    try:
        log_dir = Path(__file__).parent.parent / "logs"
        log_dir.mkdir(exist_ok=True)

        log_file = log_dir / f"mining_{datetime.now():%Y%m%d}.log"
        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setLevel(logging.DEBUG)
        file_format = logging.Formatter(
            '%(asctime)s | %(levelname)-8s | %(name)s | %(funcName)s:%(lineno)d | %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        file_handler.setFormatter(file_format)
        logger.addHandler(file_handler)
    except Exception as e:
        # 如果无法创建文件日志，只使用控制台
        logger.warning(f"无法创建文件日志: {e}")

    return logger

# 创建默认logger实例
logger = setup_logger()

# 便捷的日志函数
def log_info(message: str):
    """记录INFO级别日志"""
    logger.info(message)

def log_debug(message: str):
    """记录DEBUG级别日志"""
    logger.debug(message)

def log_warning(message: str):
    """记录WARNING级别日志"""
    logger.warning(message)

def log_error(message: str, exc_info: bool = False):
    """记录ERROR级别日志，可选是否包含异常堆栈"""
    logger.error(message, exc_info=exc_info)

def log_api_request(method: str, path: str, status_code: int = None, duration_ms: float = None):
    """记录API请求日志"""
    parts = [f"{method} {path}"]
    if status_code:
        parts.append(f"-> {status_code}")
    if duration_ms:
        parts.append(f"({duration_ms:.0f}ms)")
    logger.info(" ".join(parts))

def log_design_operation(operation: str, details: dict = None):
    """记录设计操作日志"""
    msg = f"[设计] {operation}"
    if details:
        detail_str = ", ".join(f"{k}={v}" for k, v in details.items())
        msg += f" | {detail_str}"
    logger.info(msg)
