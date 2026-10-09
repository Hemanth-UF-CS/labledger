"""Sample registry contents: nine researchers, their projects, dataset versions and model versions.

Deterministic, so every fresh database comes up identical.
"""
import hashlib
import json
import random
from datetime import date, datetime, timedelta, timezone

import asyncpg

from .. import logs

log = logs.get("seed")
UTC = timezone.utc

RESEARCHERS = [
    ("hreddy", "Hemanth Reddy", "Graduate Researcher", "Edge ML for soil surface sensing", date(2025, 1, 6)),
    ("mokafor", "Maya Okafor", "PhD Candidate", "Citrus disease detection", date(2022, 8, 15)),
    ("druiz", "Daniel Ruiz", "PhD Student", "Specialty crop yield forecasting", date(2023, 8, 14)),
    ("pnatarajan", "Priya Natarajan", "PhD Candidate", "Weed segmentation for precision spraying", date(2022, 1, 10)),
    ("lzhao", "Lin Zhao", "Postdoctoral Associate", "Agrometeorology and evapotranspiration", date(2024, 3, 1)),
    ("tbrooks", "Tyler Brooks", "M.S. Student", "Fruit detection and counting", date(2024, 8, 19)),
    ("abello", "Aisha Bello", "PhD Student", "Livestock behavior from wearable sensors", date(2023, 1, 9)),
    ("kmensah", "Kwame Mensah", "PhD Student", "Hyperspectral crop nutrient estimation", date(2023, 8, 14)),
    ("sherrera", "Sofia Herrera", "PhD Student", "Soil moisture forecasting for irrigation", date(2024, 1, 8)),
]


def _sha(*parts) -> str:
    return hashlib.sha1("/".join(map(str, parts)).encode()).hexdigest()


def _sha256(*parts) -> str:
    return hashlib.sha256("/".join(map(str, parts)).encode()).hexdigest()


def _ts(d: str, hour: int = 15) -> datetime:
    y, m, dd = map(int, d.split("-"))
    return datetime(y, m, dd, hour, 0, tzinfo=UTC) + timedelta(minutes=(y * m * dd) % 57)


# Each project: owner, task, primary metric, datasets (with versions), and model versions.
# Model version tuple: (version, date, dataset_version_index, architecture, hyperparam overrides,
#                       primary metric value, stage, parent version, note)
PROJECTS = [
    {
        "slug": "wetdry", "name": "Soil surface wet/dry classification", "owner": "hreddy",
        "task": "Binary classification from Pi camera frames plus a sensor sequence",
        "description": "Classifies the soil surface under each field node as wet (1) or dry (0) from the "
                       "latest camera frame and the preceding sensor window. Runs on the Raspberry Pi nodes "
                       "as an int8 TFLite model; output feeds the FieldSense dashboard and irrigation alerts.",
        "metric": "f1", "higher": True, "framework": "PyTorch 2.3 / TFLite",
        "dataset": ("wetdry-frames", "Wet/dry labeled field frames",
                    "Top-down Pi Camera Module 3 frames from field nodes, each aligned with the 2 h of "
                    "sensor readings before capture. Labels from manual annotation plus rain-gauge cross-check.",
                    "image + time series",
                    [(3120, "2025-03-04", "Initial set. Nodes N01-N04, Feb-Mar 2025."),
                     (7840, "2025-06-17", "Added early-summer rain events; 212 ambiguous dusk frames relabeled."),
                     (12460, "2025-11-20", "Added N05/N06. Night frames excluded (no IR illumination)."),
                     (18930, "2026-06-09", "Spring 2026 season. Splits stratified by node and hour of day.")]),
        "base_hp": {"backbone": "mobilenetv3_small_100", "image_size": 224, "seq_len": 24,
                    "seq_features": ["soil_moisture", "soil_temp", "air_temp", "humidity", "light"],
                    "lstm_hidden": 64, "lstm_layers": 1, "dropout": 0.2, "optimizer": "adamw", "lr": 3e-4,
                    "weight_decay": 1e-4, "batch_size": 32, "epochs": 40, "loss": "bce",
                    "pos_weight": 1.0, "augment": ["hflip"], "export": "tflite_int8"},
        "models": [
            ("0.1.0", "2025-03-21", 0, "ResNet-18 (frames only)",
             {"backbone": "resnet18", "seq_len": 0, "seq_features": [], "lstm_hidden": 0, "lstm_layers": 0, "export": "onnx"},
             0.842, "archived", None, "Frame-only baseline. Misses wet soil at dusk and under shade."),
            ("0.2.0", "2025-04-09", 0, "MobileNetV3-S + LSTM", {}, 0.881, "archived", "0.1.0",
             "First CNN-LSTM. 2 h sensor window (5-min steps) fused after the image embedding."),
            ("0.3.0", "2025-06-25", 1, "MobileNetV3-S + LSTM", {"pos_weight": 1.6}, 0.903, "archived", "0.2.0",
             "Retrained on frames v2; positive class weighted for the drier summer distribution."),
            ("1.0.0", "2025-08-12", 1, "MobileNetV3-S + LSTM", {"pos_weight": 1.6, "augment": ["hflip", "color_jitter"]},
             0.917, "archived", "0.3.0", "First on-node deployment (int8 TFLite, ~190 ms on Pi 4B)."),
            ("1.1.0", "2025-10-02", 1, "MobileNetV3-S + LSTM", {"pos_weight": 1.6, "seq_len": 36, "augment": ["hflip", "color_jitter"]},
             0.921, "archived", "1.0.0", "3 h sensor window. Small gain, mostly on post-irrigation frames."),
            ("1.2.0", "2025-12-04", 2, "MobileNetV3-S + LSTM", {"pos_weight": 1.6, "seq_len": 36, "augment": ["hflip", "color_jitter"]},
             0.934, "archived", "1.1.0", "Retrained on frames v3 (adds N05/N06)."),
            ("1.3.0", "2026-02-17", 2, "MobileNetV3-S + LSTM",
             {"pos_weight": 1.6, "seq_len": 36, "lstm_hidden": 96, "dropout": 0.3, "augment": ["hflip", "color_jitter"]},
             0.928, "archived", "1.2.0", "Larger LSTM. Regressed on N04 low-light frames; not promoted."),
            ("1.4.0", "2026-03-30", 2, "MobileNetV3-S + LSTM",
             {"pos_weight": 1.6, "seq_len": 36, "augment": ["hflip", "color_jitter", "random_shadow"]},
             0.941, "archived", "1.2.0", "Synthetic shadow augmentation fixes most stake-shadow false wets."),
            ("1.5.0", "2026-06-29", 3, "MobileNetV3-S + LSTM",
             {"pos_weight": 1.4, "seq_len": 36, "augment": ["hflip", "color_jitter", "random_shadow"]},
             0.948, "archived", "1.4.0", "Retrained on frames v4. Production 2026-07-06 to 2026-09-22."),
            ("1.6.0", "2026-09-15", 3, "MobileNetV3-S + LSTM",
             {"loss": "focal", "focal_gamma": 2.0, "pos_weight": 1.0, "seq_len": 36,
              "augment": ["hflip", "color_jitter", "random_shadow"]},
             0.953, "production", "1.5.0", "Focal loss (gamma 2). Promoted to production 2026-09-22."),
            ("1.7.0-rc1", "2026-10-01", 3, "MobileNetV3-S + LSTM + temporal attention",
             {"loss": "focal", "focal_gamma": 2.0, "pos_weight": 1.0, "seq_len": 36, "temporal_attention": True,
              "augment": ["hflip", "color_jitter", "random_shadow"]},
             0.955, "staging", "1.6.0", "Attention over LSTM outputs. Shadow-testing on N01-N03 before promotion."),
        ],
    },
    {
        "slug": "citrus-hlb", "name": "HLB leaf detection", "owner": "mokafor",
        "task": "Binary image classification (HLB symptomatic vs. healthy)",
        "description": "Detects Huanglongbing (citrus greening) symptoms from leaf photographs taken in grove "
                       "scouting. Used to prioritise trees for qPCR confirmation.",
        "metric": "auroc", "higher": True, "framework": "PyTorch 2.3",
        "dataset": ("hlb-leaf-images", "HLB leaf photographs",
                    "Smartphone leaf photos from scouting runs, qPCR-confirmed labels for a subset.",
                    "image",
                    [(4200, "2024-11-12", "Two groves, Valencia and Hamlin."),
                     (9850, "2025-05-06", "Added three groves; blotchy-mottle vs. zinc deficiency hard negatives."),
                     (14300, "2026-01-27", "Winter flush leaves added; qPCR-confirmed test split.")]),
        "base_hp": {"backbone": "efficientnet_b0", "image_size": 384, "optimizer": "adamw", "lr": 2e-4,
                    "batch_size": 48, "epochs": 30, "augment": ["hflip", "vflip", "rotate"], "label_smoothing": 0.0},
        "models": [
            ("0.1.0", "2025-01-14", 0, "EfficientNet-B0", {}, 0.887, "archived", None, "Baseline."),
            ("0.2.0", "2025-03-03", 0, "EfficientNet-B0", {"augment": ["hflip", "vflip", "rotate", "color_jitter"], "label_smoothing": 0.1},
             0.904, "archived", "0.1.0", "Color jitter + label smoothing."),
            ("0.3.0", "2025-05-20", 1, "EfficientNet-B3", {"backbone": "efficientnet_b3", "batch_size": 24, "label_smoothing": 0.1},
             0.921, "archived", "0.2.0", "B3 on dataset v2."),
            ("1.0.0", "2025-07-08", 1, "EfficientNet-B3", {"backbone": "efficientnet_b3", "batch_size": 24, "label_smoothing": 0.1, "epochs": 45},
             0.928, "production", "0.3.0", "Used for 2025-26 scouting season."),
            ("1.1.0", "2026-02-10", 2, "ViT-S/16", {"backbone": "vit_small_patch16_384", "batch_size": 32, "lr": 5e-5},
             0.925, "development", "1.0.0", "No better than B3 at ~3x inference cost."),
            ("1.2.0", "2026-03-18", 2, "EfficientNet-B3", {"backbone": "efficientnet_b3", "batch_size": 24, "label_smoothing": 0.1, "cutmix": 0.5, "epochs": 45},
             0.934, "staging", "1.0.0", "CutMix. Awaiting spring flush validation."),
        ],
    },
    {
        "slug": "strawberry-yield", "name": "Strawberry weekly yield forecast", "owner": "druiz",
        "task": "Time-series regression, 1-4 week horizon",
        "description": "Forecasts weekly marketable strawberry yield per field block from harvest records, "
                       "weather, and canopy size.",
        "metric": "mape", "higher": False, "framework": "LightGBM 4.3 / PyTorch Forecasting",
        "dataset": ("strawberry-harvest-weekly", "Weekly strawberry harvest records",
                    "Block-level weekly harvest weights joined to FAWN weather and drone canopy area.",
                    "tabular time series",
                    [(1840, "2024-09-02", "Seasons 2022-23 and 2023-24."),
                     (2790, "2025-08-25", "Adds 2024-25 season and canopy area from drone flights.")]),
        "base_hp": {"model": "lightgbm", "horizon_weeks": 4, "lookback_weeks": 8, "num_leaves": 31,
                    "learning_rate": 0.05, "n_estimators": 600, "features": ["harvest_lag", "gdd", "solar_rad"]},
        "models": [
            ("0.1.0", "2024-10-15", 0, "LightGBM", {}, 14.8, "archived", None, "Lag features only."),
            ("0.2.0", "2024-12-03", 0, "LightGBM", {"features": ["harvest_lag", "gdd", "solar_rad", "chill_hours", "rain_7d"]},
             12.1, "archived", "0.1.0", "Weather features."),
            ("0.3.0", "2025-03-11", 0, "Temporal Fusion Transformer",
             {"model": "tft", "hidden_size": 32, "attention_heads": 4, "dropout": 0.1, "learning_rate": 1e-3, "max_epochs": 60},
             11.4, "archived", "0.2.0", "TFT, quantile loss."),
            ("1.0.0", "2025-09-16", 1, "Temporal Fusion Transformer",
             {"model": "tft", "hidden_size": 48, "attention_heads": 4, "dropout": 0.1, "learning_rate": 1e-3, "max_epochs": 80},
             10.2, "production", "0.3.0", "Production for 2025-26 season."),
            ("1.1.0", "2026-04-22", 1, "Temporal Fusion Transformer",
             {"model": "tft", "hidden_size": 48, "attention_heads": 4, "dropout": 0.1, "learning_rate": 1e-3, "max_epochs": 80,
              "features": ["harvest_lag", "gdd", "solar_rad", "chill_hours", "rain_7d", "canopy_area"]},
             9.7, "staging", "1.0.0", "Adds drone canopy area."),
        ],
    },
    {
        "slug": "weed-seg", "name": "Weed segmentation in peanut", "owner": "pnatarajan",
        "task": "Semantic segmentation (crop / weed / soil)",
        "description": "Pixel-level weed maps from tractor-mounted RGB camera for a targeted spray prototype.",
        "metric": "miou", "higher": True, "framework": "PyTorch 2.3 / segmentation-models-pytorch",
        "dataset": ("peanut-weed-masks", "Peanut row weed masks",
                    "1024x768 tractor camera frames with polygon masks for crop, weed, soil.",
                    "image + mask",
                    [(1150, "2024-07-22", "Summer 2024, one field."),
                     (2480, "2025-02-10", "Second field; nutsedge and pigweed classes merged to 'weed'."),
                     (3960, "2026-05-04", "2025 season, varied growth stages.")]),
        "base_hp": {"arch": "unet", "encoder": "resnet34", "image_size": 768, "optimizer": "adam", "lr": 1e-4,
                    "batch_size": 8, "epochs": 80, "loss": "dice+ce"},
        "models": [
            ("0.1.0", "2024-08-30", 0, "U-Net / ResNet-34", {}, 0.612, "archived", None, "Baseline."),
            ("0.2.0", "2024-11-05", 0, "U-Net / ResNet-50", {"encoder": "resnet50", "batch_size": 6}, 0.648, "archived", "0.1.0", ""),
            ("0.3.0", "2025-03-04", 1, "DeepLabV3+ / ResNet-50", {"arch": "deeplabv3plus", "encoder": "resnet50", "batch_size": 6},
             0.681, "archived", "0.2.0", "Dataset v2."),
            ("0.4.0", "2025-04-29", 1, "DeepLabV3+ / ResNet-101", {"arch": "deeplabv3plus", "encoder": "resnet101", "batch_size": 4},
             0.689, "archived", "0.3.0", "Too slow for the Jetson target (11 fps)."),
            ("1.0.0", "2025-07-14", 1, "SegFormer-B2", {"arch": "segformer", "encoder": "mit_b2", "lr": 6e-5, "optimizer": "adamw", "batch_size": 8},
             0.712, "production", "0.3.0", "24 fps on Jetson Orin NX at 768 px."),
            ("1.1.0", "2026-05-26", 2, "SegFormer-B2", {"arch": "segformer", "encoder": "mit_b2", "lr": 6e-5, "optimizer": "adamw", "batch_size": 8, "epochs": 120},
             0.724, "development", "1.0.0", "Dataset v3; still checking small-weed recall."),
        ],
    },
    {
        "slug": "et0", "name": "Reference ET from limited weather inputs", "owner": "lzhao",
        "task": "Regression of daily FAO-56 reference ET",
        "description": "Estimates daily reference evapotranspiration where only temperature and humidity are "
                       "measured, using FAWN stations with full Penman-Monteith inputs as ground truth.",
        "metric": "rmse_mm_day", "higher": False, "framework": "scikit-learn 1.5 / XGBoost 2.0",
        "dataset": ("fawn-daily-weather", "FAWN daily weather with PM ET0",
                    "Daily aggregates from 42 Florida Automated Weather Network stations with FAO-56 PM ET0.",
                    "tabular",
                    [(184200, "2024-04-08", "2010-2023, station-day rows."),
                     (199500, "2025-02-03", "Adds 2024; removes 3 stations with sensor drift.")]),
        "base_hp": {"model": "linear", "features": ["tmax", "tmin", "rh_mean", "doy", "lat"], "cv": "leave-station-out"},
        "models": [
            ("0.1.0", "2024-05-02", 0, "Calibrated Hargreaves (linear)", {}, 0.71, "archived", None, "Physics baseline."),
            ("0.2.0", "2024-06-18", 0, "XGBoost", {"model": "xgboost", "max_depth": 6, "eta": 0.05, "n_estimators": 900, "subsample": 0.8},
             0.46, "archived", "0.1.0", ""),
            ("0.3.0", "2024-09-10", 0, "MLP", {"model": "mlp", "hidden": [128, 64], "lr": 1e-3, "epochs": 200},
             0.49, "development", "0.2.0", "No gain over XGBoost."),
            ("1.0.0", "2025-02-24", 1, "XGBoost", {"model": "xgboost", "max_depth": 7, "eta": 0.03, "n_estimators": 1400, "subsample": 0.8,
                                                   "features": ["tmax", "tmin", "rh_mean", "doy", "lat", "ra"]},
             0.41, "production", "0.2.0", "Adds extraterrestrial radiation; dataset v2."),
        ],
    },
    {
        "slug": "blueberry-count", "name": "Blueberry cluster counting", "owner": "tbrooks",
        "task": "Object detection and counting",
        "description": "Detects and counts blueberry clusters by ripeness stage from handheld canopy images.",
        "metric": "map50", "higher": True, "framework": "Ultralytics 8.2",
        "dataset": ("blueberry-canopy-boxes", "Blueberry canopy bounding boxes",
                    "Handheld canopy photos with boxes for green, pink, and blue clusters.",
                    "image + boxes",
                    [(1620, "2025-04-21", "2025 harvest, southern highbush."),
                     (2940, "2026-04-14", "2026 harvest, adds rabbiteye cultivars.")]),
        "base_hp": {"model": "yolov8n", "imgsz": 640, "epochs": 150, "batch": 16, "optimizer": "SGD", "lr0": 0.01, "mosaic": 1.0},
        "models": [
            ("0.1.0", "2025-05-06", 0, "YOLOv8n", {}, 0.712, "archived", None, ""),
            ("0.2.0", "2025-05-28", 0, "YOLOv8s", {"model": "yolov8s"}, 0.758, "archived", "0.1.0", ""),
            ("0.3.0", "2025-07-01", 0, "YOLOv8s", {"model": "yolov8s", "imgsz": 1280, "batch": 8}, 0.781, "archived", "0.2.0",
             "Higher resolution helps small green clusters."),
            ("1.0.0", "2026-05-05", 1, "YOLOv8m", {"model": "yolov8m", "imgsz": 1280, "batch": 8}, 0.794, "production", "0.3.0", ""),
            ("1.1.0", "2026-06-16", 1, "RT-DETR-L", {"model": "rtdetr-l", "imgsz": 1280, "batch": 4, "optimizer": "AdamW", "lr0": 1e-4},
             0.789, "development", "1.0.0", "Comparable mAP, 2x slower on the phone."),
        ],
    },
    {
        "slug": "cattle-behavior", "name": "Grazing behavior from collar accelerometers", "owner": "abello",
        "task": "Multi-class time-series classification (graze / ruminate / rest / walk)",
        "description": "Classifies cattle behavior from 10 Hz tri-axial collar accelerometers in 10 s windows.",
        "metric": "macro_f1", "higher": True, "framework": "PyTorch 2.3 / scikit-learn 1.5",
        "dataset": ("collar-accel-10hz", "Collar accelerometer windows",
                    "10 s windows at 10 Hz with video-annotated behavior labels.",
                    "time series",
                    [(48300, "2024-03-18", "12 heifers, 3 weeks."),
                     (112600, "2025-06-30", "31 animals across two pastures.")]),
        "base_hp": {"model": "random_forest", "window_s": 10, "hz": 10, "n_estimators": 400, "features": "handcrafted_stats"},
        "models": [
            ("0.1.0", "2024-04-11", 0, "Random forest (handcrafted)", {}, 0.781, "archived", None, ""),
            ("0.2.0", "2024-07-09", 0, "1D-CNN", {"model": "cnn1d", "channels": [32, 64, 64], "kernel": 5, "lr": 1e-3, "epochs": 60, "features": "raw"},
             0.826, "archived", "0.1.0", ""),
            ("0.3.0", "2025-07-22", 1, "1D-CNN + GRU", {"model": "cnn1d_gru", "channels": [32, 64, 64], "kernel": 5, "gru_hidden": 64, "lr": 1e-3, "epochs": 60, "features": "raw"},
             0.849, "production", "0.2.0", ""),
            ("0.4.0", "2026-01-13", 1, "InceptionTime", {"model": "inception_time", "depth": 6, "nb_filters": 32, "lr": 1e-3, "epochs": 80, "features": "raw"},
             0.853, "staging", "0.3.0", "Marginal gain; checking on held-out pasture."),
        ],
    },
    {
        "slug": "leaf-nitrogen", "name": "Leaf nitrogen from hyperspectral reflectance", "owner": "kmensah",
        "task": "Regression (leaf N %)",
        "description": "Estimates sweet corn leaf nitrogen concentration from 400-1000 nm leaf-clip reflectance.",
        "metric": "r2", "higher": True, "framework": "scikit-learn 1.5 / PyTorch 2.3",
        "dataset": ("sweetcorn-hyperspec", "Sweet corn leaf spectra",
                    "Leaf-clip spectra (2 nm bands) paired with lab-assayed leaf N.",
                    "spectra",
                    [(640, "2024-10-07", "Spring 2024 N-rate trial."),
                     (1380, "2025-10-13", "Adds spring 2025 trial and a second cultivar.")]),
        "base_hp": {"model": "plsr", "n_components": 12, "bands": "400-1000nm", "preprocess": ["savgol"]},
        "models": [
            ("0.1.0", "2024-11-04", 0, "PLSR", {}, 0.71, "archived", None, ""),
            ("0.2.0", "2025-02-19", 0, "1D-CNN", {"model": "cnn1d", "channels": [16, 32, 64], "kernel": 7, "lr": 5e-4, "epochs": 300}, 0.78, "archived", "0.1.0", ""),
            ("0.3.0", "2025-11-03", 1, "1D-CNN", {"model": "cnn1d", "channels": [16, 32, 64], "kernel": 7, "lr": 5e-4, "epochs": 300, "preprocess": ["savgol", "snv"]},
             0.82, "production", "0.2.0", "SNV normalisation; dataset v2."),
        ],
    },
    {
        "slug": "vwc-forecast", "name": "Root-zone soil moisture forecast", "owner": "sherrera",
        "task": "24 h ahead VWC forecasting",
        "description": "Forecasts 10-30 cm volumetric water content 24 h ahead to schedule drip irrigation. "
                       "Trained on FieldSense node readings plus NWS forecasts.",
        "metric": "rmse_vwc", "higher": False, "framework": "PyTorch 2.3",
        "dataset": ("fieldsense-vwc-series", "FieldSense VWC series",
                    "Hourly resampled readings from FieldSense nodes N01-N06 with irrigation logs.",
                    "time series",
                    [(51800, "2025-12-15", "Aug-Nov 2025."),
                     (98400, "2026-07-20", "Through June 2026; irrigation events reconciled with valve logs.")]),
        "base_hp": {"model": "lstm", "lookback_h": 72, "horizon_h": 24, "hidden": 64, "layers": 2, "lr": 1e-3, "epochs": 50},
        "models": [
            ("0.1.0", "2026-01-20", 0, "LSTM", {}, 1.84, "archived", None, "Sensor history only."),
            ("0.2.0", "2026-03-09", 0, "LSTM", {"exogenous": ["nws_qpf", "nws_tmax", "irrigation_plan"]}, 1.42, "development", "0.1.0", "Adds NWS forecast inputs."),
            ("0.3.0", "2026-08-04", 1, "TCN", {"model": "tcn", "channels": [64, 64, 64], "kernel": 3, "exogenous": ["nws_qpf", "nws_tmax", "irrigation_plan"]},
             1.37, "staging", "0.2.0", "Dataset v2."),
        ],
    },
]

HOSTS = [("hpg-c0412", "NVIDIA A100 80GB"), ("hpg-c0507", "NVIDIA A100 80GB"),
         ("hpg-b1121", "NVIDIA B200"), ("abe-ws-02", "NVIDIA RTX 4090"), ("abe-ws-05", "NVIDIA RTX A6000")]


def _secondary(metric: str, value: float, rng: random.Random) -> dict:
    """Plausible companion metrics for a primary metric value."""
    r = lambda x: round(x, 4)
    if metric in ("f1", "macro_f1"):
        p = min(0.995, value + rng.uniform(-0.02, 0.02))
        rec = min(0.995, value * p / max(2 * p - value, 1e-6))
        return {metric: r(value), "precision": r(p), "recall": r(rec), "accuracy": r(min(0.995, value + rng.uniform(0.005, 0.02)))}
    if metric == "auroc":
        return {"auroc": r(value), "accuracy": r(value - rng.uniform(0.04, 0.07)), "sensitivity": r(value - rng.uniform(0.02, 0.06))}
    if metric == "mape":
        return {"mape": round(value, 2), "rmse_kg_ha": round(value * rng.uniform(31, 36), 1), "coverage_p90": r(rng.uniform(0.84, 0.91))}
    if metric == "miou":
        return {"miou": r(value), "iou_weed": r(value - rng.uniform(0.06, 0.1)), "iou_crop": r(value + rng.uniform(0.05, 0.09))}
    if metric == "rmse_mm_day":
        return {"rmse_mm_day": round(value, 3), "mae_mm_day": round(value * rng.uniform(0.74, 0.8), 3), "r2": r(1 - value * rng.uniform(0.17, 0.2))}
    if metric == "map50":
        return {"map50": r(value), "map50_95": r(value * rng.uniform(0.58, 0.63)), "count_mae": round((1 - value) * rng.uniform(9, 12), 2)}
    if metric == "r2":
        return {"r2": r(value), "rmse_pct_n": round((1 - value) * rng.uniform(0.9, 1.1), 3)}
    if metric == "rmse_vwc":
        return {"rmse_vwc": round(value, 3), "mae_vwc": round(value * rng.uniform(0.72, 0.78), 3)}
    return {metric: value}


async def seed(conn: asyncpg.Connection) -> bool:
    if await conn.fetchval("SELECT count(*) FROM researchers"):
        return False
    rng = random.Random(1729)
    async with conn.transaction():
        rid = {}
        for handle, name, role, focus, joined in RESEARCHERS:
            rid[handle] = await conn.fetchval(
                "INSERT INTO researchers (handle, name, role, focus, joined_at) VALUES ($1,$2,$3,$4,$5) RETURNING id",
                handle, name, role, focus, joined)

        events = []
        for p in PROJECTS:
            owner = rid[p["owner"]]
            first_ds_date = p["dataset"][4][0][1]
            pid = await conn.fetchval(
                """INSERT INTO projects (slug, name, description, task, primary_metric, metric_higher_is_better, owner_id, created_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id""",
                p["slug"], p["name"], p["description"], p["task"], p["metric"], p["higher"], owner,
                _ts(first_ds_date, 13) - timedelta(days=21))

            ds_slug, ds_name, ds_desc, modality, versions = p["dataset"]
            dsid = await conn.fetchval(
                "INSERT INTO datasets (slug, name, description, modality, project_id, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
                ds_slug, ds_name, ds_desc, modality, pid, _ts(versions[0][1], 13))
            dsv_ids = []
            for i, (n, d, note) in enumerate(versions, start=1):
                bytes_per = {"image + time series": 61_000, "image": 420_000, "image + mask": 910_000,
                             "image + boxes": 2_300_000, "spectra": 2_600}.get(modality, 180)
                splits = {"train": round(n * 0.7), "val": round(n * 0.15), "test": n - round(n * 0.7) - round(n * 0.15)}
                dsv = await conn.fetchval(
                    """INSERT INTO dataset_versions (dataset_id, version, uri, n_samples, size_bytes, checksum, splits, notes, created_by, created_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id""",
                    dsid, i, f"s3://abe-ml-registry/datasets/{ds_slug}/v{i}/", n,
                    int(n * bytes_per * rng.uniform(0.9, 1.1)), _sha256(ds_slug, i), splits, note, owner, _ts(d, 14))
                dsv_ids.append(dsv)
                events.append((_ts(d, 14), owner, "dataset_version.published", "dataset_version", dsv,
                               f"Published {ds_slug} v{i} ({n:,} samples)"))

            by_version = {}
            for version, d, dsi, arch, overrides, value, stage, parent, note in p["models"]:
                hp = {**p["base_hp"], **overrides}
                hp["seed"] = 17
                created = _ts(d, 16)
                commit = _sha(p["slug"], version)
                ext = "tflite" if "tflite" in str(hp.get("export", "")) else ("pkl" if hp.get("model") in ("lightgbm", "xgboost", "linear", "plsr", "random_forest") else "pt")
                mvid = await conn.fetchval(
                    """INSERT INTO model_versions (project_id, name, version, framework, architecture, hyperparams,
                           dataset_version_id, code_repo, code_commit, parent_id, stage, artifact_uri, artifact_bytes,
                           notes, created_by, created_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id""",
                    pid, p["slug"], version, p["framework"], arch, hp, dsv_ids[dsi],
                    f"git.abe-lab.internal/ml/{p['slug']}", commit, by_version.get(parent), stage,
                    f"s3://abe-ml-registry/models/{p['slug']}/{version}/model.{ext}",
                    rng.randint(2_000_000, 120_000_000) if ext != "pkl" else rng.randint(300_000, 9_000_000),
                    note, owner, created)
                by_version[version] = mvid
                events.append((created, owner, "model_version.registered", "model_version", mvid,
                               f"Registered {p['slug']} {version} ({arch})"))

                # training runs: the last completed run is the one that produced the registered artifact
                n_runs = rng.choice([1, 2, 2, 3, 4])
                for k in range(n_runs):
                    host, acc = rng.choice(HOSTS)
                    start = created - timedelta(hours=rng.randint(6, 30) * (n_runs - k))
                    dur = timedelta(minutes=rng.randint(25, 400))
                    status = "completed" if k == n_runs - 1 else rng.choice(["completed", "completed", "failed", "killed"])
                    m = _secondary(p["metric"], value + (rng.uniform(-0.01, 0.0) if p["higher"] else rng.uniform(0, 0.05)), rng) \
                        if status == "completed" else {}
                    if status == "completed" and k == n_runs - 1:
                        m = _secondary(p["metric"], value, random.Random(mvid))
                    await conn.execute(
                        """INSERT INTO runs (model_version_id, status, host, accelerator, seed, started_at, finished_at, metrics)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                        mvid, status, host, acc, 17 + k, start, start + dur, m)

                # results: val and test on its own dataset version
                for split, delta in (("val", 0.0), ("test", -0.004 if p["higher"] else 0.02)):
                    v = value + delta
                    await conn.execute(
                        """INSERT INTO evaluations (model_version_id, dataset_version_id, split, metrics, created_at)
                           VALUES ($1,$2,$3,$4,$5)""",
                        mvid, dsv_ids[dsi], split, _secondary(p["metric"], v, random.Random(mvid * 7 + len(split))),
                        created + timedelta(hours=2))
                # re-evaluation on the newest dataset version, so results stay comparable across data changes
                if dsi < len(dsv_ids) - 1 and stage in ("production", "archived"):
                    v = value - (0.012 if p["higher"] else -0.06 * value)
                    await conn.execute(
                        """INSERT INTO evaluations (model_version_id, dataset_version_id, split, metrics, created_at)
                           VALUES ($1,$2,$3,$4,$5)""",
                        mvid, dsv_ids[-1], "test", _secondary(p["metric"], v, random.Random(mvid * 13)),
                        _ts(versions[-1][1], 18) + timedelta(days=2))

                if stage in ("production", "staging"):
                    events.append((created + timedelta(days=rng.randint(3, 7)), owner, f"model_version.stage.{stage}",
                                   "model_version", mvid, f"Moved {p['slug']} {version} to {stage}"))

        await conn.executemany(
            "INSERT INTO events (at, actor_id, kind, subject_type, subject_id, summary) VALUES ($1,$2,$3,$4,$5,$6)",
            sorted(events))
    log.info("registry_seeded", researchers=len(RESEARCHERS), projects=len(PROJECTS),
             model_versions=sum(len(p["models"]) for p in PROJECTS))
    return True
