from PIL import Image, ImageDraw, ImageFont
import os

# 输出目录
OUT_DIR = "src-tauri/icons"
os.makedirs(OUT_DIR, exist_ok=True)

# 品牌色
BG_COLOR = (229, 163, 73)  # #e5a349
BG_DARK = (209, 143, 53)
TEXT_COLOR = (255, 255, 255)
SHADOW_COLOR = (0, 0, 0, 40)


def create_squircle_mask(size, radius_ratio=0.28):
    """创建圆角矩形（squircle）遮罩"""
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    radius = int(size * radius_ratio)
    draw.rounded_rectangle((0, 0, size, size), radius=radius, fill=255)
    return mask


def create_base_icon(size):
    """生成指定尺寸的圆角图标"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    # 背景：带轻微渐变
    bg = Image.new("RGBA", (size, size), BG_COLOR)
    draw = ImageDraw.Draw(bg)
    for i in range(size):
        ratio = i / size
        r = int(BG_COLOR[0] - (BG_COLOR[0] - BG_DARK[0]) * ratio * 0.3)
        g = int(BG_COLOR[1] - (BG_COLOR[1] - BG_DARK[1]) * ratio * 0.3)
        b = int(BG_COLOR[2] - (BG_COLOR[2] - BG_DARK[2]) * ratio * 0.3)
        draw.line([(0, i), (size, i)], fill=(r, g, b))

    # 应用 squircle 遮罩
    mask = create_squircle_mask(size)
    img.paste(bg, (0, 0), mask)

    # 绘制文字 "LR"
    draw = ImageDraw.Draw(img)
    text = "LR"

    # 尝试加载系统字体
    font_paths = [
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/calibri.ttf",
        "C:/Windows/Fonts/tahoma.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    font = None
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                font = ImageFont.truetype(fp, int(size * 0.48))
                break
            except Exception:
                pass
    if font is None:
        font = ImageFont.load_default()

    # 计算文字居中位置
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    x = (size - text_width) / 2 - bbox[0]
    y = (size - text_height) / 2 - bbox[1] - int(size * 0.02)

    # 绘制阴影
    draw.text((x + size * 0.015, y + size * 0.015), text, font=font, fill=SHADOW_COLOR)
    # 绘制文字
    draw.text((x, y), text, font=font, fill=TEXT_COLOR)

    return img


def save_png(img, filename, size):
    """保存为指定尺寸的 PNG"""
    resized = img.resize((size, size), Image.Resampling.LANCZOS)
    resized.save(os.path.join(OUT_DIR, filename), "PNG")


def create_ico(sizes):
    """创建 Windows 图标文件"""
    images = []
    for size in sizes:
        img = create_base_icon(size)
        images.append(img)
    images[0].save(
        os.path.join(OUT_DIR, "icon.ico"),
        format="ICO",
        sizes=[(img.width, img.height) for img in images],
    )


# 先生成 1024 基准图，再导出各种尺寸
base = create_base_icon(1024)

# 主图标
save_png(base, "icon.png", 1024)

# 标准图标尺寸
save_png(base, "128x128.png", 128)
save_png(base, "128x128@2x.png", 256)
save_png(base, "32x32.png", 32)

# Windows 商店/磁贴图标
save_png(base, "StoreLogo.png", 50)
save_png(base, "Square30x30Logo.png", 30)
save_png(base, "Square44x44Logo.png", 44)
save_png(base, "Square71x71Logo.png", 71)
save_png(base, "Square89x89Logo.png", 89)
save_png(base, "Square107x107Logo.png", 107)
save_png(base, "Square142x142Logo.png", 142)
save_png(base, "Square150x150Logo.png", 150)
save_png(base, "Square284x284Logo.png", 284)
save_png(base, "Square310x310Logo.png", 310)

# Windows ico（包含多个尺寸）
create_ico([16, 24, 32, 48, 64, 128, 256])

print("Icons generated in", OUT_DIR)
