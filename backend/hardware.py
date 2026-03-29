import json
import platform
import subprocess

import psutil


def detect_hardware() -> dict:
    result = {
        "mode": "cpu",
        "gpu_vendor": None,
        "gpu_name": None,
        "vram_total_gb": None,
        "ram_total_gb": round(psutil.virtual_memory().total / (1024 ** 3), 1),
        "cpu_name": _get_cpu_name(),
        "cpu_cores": psutil.cpu_count(logical=False) or psutil.cpu_count(),
    }

    # 1. NVIDIA
    try:
        import pynvml
        pynvml.nvmlInit()
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        name = pynvml.nvmlDeviceGetName(handle)
        if isinstance(name, bytes):
            name = name.decode()
        mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
        pynvml.nvmlShutdown()
        result.update(
            mode="nvidia",
            gpu_vendor="nvidia",
            gpu_name=name,
            vram_total_gb=round(mem.total / (1024 ** 3), 1),
        )
        return result
    except Exception:
        pass

    # 2. AMD via rocm-smi
    try:
        proc = subprocess.run(
            ["rocm-smi", "--showmeminfo", "vram", "--json"],
            capture_output=True, text=True, timeout=5,
        )
        if proc.returncode == 0:
            result.update(mode="amd", gpu_vendor="amd")
            try:
                data = json.loads(proc.stdout)
                for card_key, card in data.items():
                    total = int(card.get("VRAM Total Memory (B)", 0))
                    if total:
                        result["vram_total_gb"] = round(total / (1024 ** 3), 1)
                    for name_key in ("Card series", "Card name", "Card SKU"):
                        if name_key in card:
                            result["gpu_name"] = card[name_key]
                            break
                    break
            except Exception:
                pass
            return result
    except Exception:
        pass

    return result


def _get_cpu_name() -> str:
    try:
        if platform.system() == "Windows":
            import winreg
            key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
            )
            name, _ = winreg.QueryValueEx(key, "ProcessorNameString")
            return name.strip()
        elif platform.system() == "Linux":
            with open("/proc/cpuinfo") as f:
                for line in f:
                    if "model name" in line:
                        return line.split(":", 1)[1].strip()
        elif platform.system() == "Darwin":
            r = subprocess.run(
                ["sysctl", "-n", "machdep.cpu.brand_string"],
                capture_output=True, text=True,
            )
            return r.stdout.strip()
    except Exception:
        pass
    return platform.processor() or "Unknown CPU"


def get_system_metrics(mode: str) -> dict:
    vm = psutil.virtual_memory()
    cpu_per_core = psutil.cpu_percent(percpu=True)
    metrics = {
        "ram_used_gb": round(vm.used / (1024 ** 3), 2),
        "ram_total_gb": round(vm.total / (1024 ** 3), 1),
        "ram_percent": round(vm.percent, 1),
        "cpu_percent": round(sum(cpu_per_core) / len(cpu_per_core), 1),
        "cpu_per_core": [round(c, 1) for c in cpu_per_core],
        "vram_used_gb": None,
        "vram_total_gb": None,
        "vram_percent": None,
    }

    if mode == "nvidia":
        try:
            import pynvml
            pynvml.nvmlInit()
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
            pynvml.nvmlShutdown()
            metrics.update(
                vram_used_gb=round(mem.used / (1024 ** 3), 2),
                vram_total_gb=round(mem.total / (1024 ** 3), 1),
                vram_percent=round(mem.used / mem.total * 100, 1),
            )
        except Exception:
            pass

    elif mode == "amd":
        try:
            proc = subprocess.run(
                ["rocm-smi", "--showmeminfo", "vram", "--json"],
                capture_output=True, text=True, timeout=5,
            )
            if proc.returncode == 0:
                data = json.loads(proc.stdout)
                for card in data.values():
                    total = int(card.get("VRAM Total Memory (B)", 0))
                    used = int(card.get("VRAM Total Used Memory (B)", 0))
                    if total:
                        metrics.update(
                            vram_total_gb=round(total / (1024 ** 3), 1),
                            vram_used_gb=round(used / (1024 ** 3), 2),
                            vram_percent=round(used / total * 100, 1),
                        )
                    break
        except Exception:
            pass

    return metrics
