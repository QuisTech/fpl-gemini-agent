import asyncio
import os
import glob
import subprocess
import shutil
# pyrefly: ignore [missing-import]
from playwright.async_api import async_playwright

VOICEOVER_TEXT = (
    "Welcome to FPL Optimizer, the ultimate Generative AI Optimization Engine for your Fantasy Premier League squad. "
    "We start by instantly syncing your live FPL team right from the dashboard. "
    "Our system pulls in your squad, bank, and chips in real time. "
    "First, let's explore the Pitch View, displaying our starting eleven with projected Expected Points for the upcoming gameweek. "
    "Next, we head to the Transfers tab. "
    "Here, our Multi-Horizon Simulation Engine mathematically identifies the optimal player swaps to maximize your points. "
    "Finally, we activate the AI Agent tab. "
    "We can ask the Gemini-powered AI for custom tactical advice, like 'Who should I captain this week?'. "
    "The AI analyzes thousands of data points to generate personalized, data-driven recommendations just for your team. "
    "Upgrade today, and dominate your mini-leagues with FPL Optimizer."
)

CURSOR_INJECT_JS = """
const cursor = document.createElement('div');
cursor.id = 'virtual-cursor';
cursor.style.position = 'fixed';
cursor.style.width = '14px';
cursor.style.height = '14px';
cursor.style.background = '#10b981'; // fpl-green
cursor.style.borderRadius = '50%';
cursor.style.border = '2px solid #ffffff';
cursor.style.boxShadow = '0 0 10px #10b981, 0 0 20px #10b981';
cursor.style.pointerEvents = 'none';
cursor.style.zIndex = '99999';
cursor.style.transform = 'translate(-50%, -50%)';
cursor.style.transition = 'width 0.1s, height 0.1s, background-color 0.1s';
document.body.appendChild(cursor);

document.addEventListener('mousemove', (e) => {
  cursor.style.left = e.clientX + 'px';
  cursor.style.top = e.clientY + 'px';
});

document.addEventListener('mousedown', () => {
  cursor.style.width = '8px';
  cursor.style.height = '8px';
  cursor.style.backgroundColor = '#a855f7'; // fpl-purple
  cursor.style.boxShadow = '0 0 8px #a855f7, 0 0 15px #a855f7';
});

document.addEventListener('mouseup', () => {
  cursor.style.width = '14px';
  cursor.style.height = '14px';
  cursor.style.backgroundColor = '#10b981';
  cursor.style.boxShadow = '0 0 10px #10b981, 0 0 20px #10b981';
});
"""

current_mouse_x = 640
current_mouse_y = 360

async def smooth_move_to(page, selector):
    global current_mouse_x, current_mouse_y
    locator = page.locator(selector).first
    box = await locator.bounding_box()
    if not box:
        print(f"Warning: Selector '{selector}' bounding box not found.")
        return
    
    target_x = box["x"] + box["width"] / 2
    target_y = box["y"] + box["height"] / 2
    
    steps = 22
    for i in range(1, steps + 1):
        t = i / steps
        t_smooth = t * t * (3 - 2 * t)
        x = current_mouse_x + (target_x - current_mouse_x) * t_smooth
        y = current_mouse_y + (target_y - current_mouse_y) * t_smooth
        await page.mouse.move(x, y)
        await asyncio.sleep(0.01)
        
    current_mouse_x = target_x
    current_mouse_y = target_y
    await asyncio.sleep(0.12)

async def smooth_click(page, selector):
    await smooth_move_to(page, selector)
    await page.mouse.down()
    await asyncio.sleep(0.08)
    await page.mouse.up()
    await asyncio.sleep(0.2)

async def smooth_type(page, selector, text):
    await smooth_click(page, selector)
    await page.keyboard.type(text, delay=70)
    await asyncio.sleep(0.1)

async def smooth_scroll_to(page, target_percent):
    current_y = await page.evaluate("window.scrollY")
    max_scroll = await page.evaluate("document.documentElement.scrollHeight - window.innerHeight")
    target_y = int(target_percent * max_scroll)
    
    step = 8 if target_y > current_y else -8
    if step == 0:
        return
    steps_count = int(abs(target_y - current_y) / abs(step))
    
    for _ in range(steps_count):
        current_y += step
        await page.evaluate(f"window.scrollTo(0, {current_y})")
        await asyncio.sleep(0.008)
        
    await page.evaluate(f"window.scrollTo(0, {target_y})")
    await asyncio.sleep(0.6)

def generate_voiceover(text, output_file):
    print("1. Synthesizing voiceover narration with edge-tts (Ava voice)...")
    if os.path.exists(output_file):
        os.remove(output_file)
    cmd = [
        "edge-tts",
        "--voice", "en-US-AvaNeural",
        "--text", text,
        "--write-media", output_file
    ]
    subprocess.run(cmd, check=True)
    print(f"   [SUCCESS] Narration audio saved to {output_file}")

async def record_walkthrough(html_path, temp_dir):
    print("2. Starting Playwright video recording...")
    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)
    os.makedirs(temp_dir)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 720},
            record_video_dir=temp_dir,
            record_video_size={"width": 1280, "height": 720}
        )
        
        page = await context.new_page()
        # USE THE LOCAL INSTANCE WHERE LOCKS ARE BYPASSED
        file_url = "http://localhost:3000/"
        print(f"   Opening page: {file_url}")
        
        await page.add_init_script(CURSOR_INJECT_JS)
        await page.goto(file_url, wait_until="networkidle")
        await page.wait_for_timeout(3000)
        
        # Intro & Sync Team (~10 seconds narration)
        print("   - Recording Sync Team")
        await smooth_type(page, "input[placeholder='TEAM ID']", "1")
        await smooth_click(page, "button:has-text('SYNC TEAM')")
        # Give it 6 seconds to load and sync
        await page.wait_for_timeout(6000)
        
        # On successful sync, it auto-navigates to Transfers.
        # But narration says "First, let's explore the Pitch View"
        # So we navigate to Pitch View.
        print("   - Recording Pitch View")
        await smooth_click(page, "button:has-text('pitch')")
        await page.wait_for_timeout(2000)
        
        # Scroll to show the players in full glory
        await smooth_scroll_to(page, 0.4)
        await page.wait_for_timeout(2000)
        await smooth_scroll_to(page, 0.8)
        await page.wait_for_timeout(2000)
        await smooth_scroll_to(page, 0.0) # Scroll back up
        await page.wait_for_timeout(1000)

        # "Next, we head to the Transfers tab." (~15 seconds into video)
        print("   - Recording Transfers Tab")
        await smooth_click(page, "button:has-text('transfers')")
        await page.wait_for_timeout(3000)
        
        # Scroll around the Transfers view
        await smooth_scroll_to(page, 0.5)
        await page.wait_for_timeout(3000)
        await smooth_scroll_to(page, 0.0)
        await page.wait_for_timeout(1000)
        
        # "Finally, we activate the AI Agent tab." (~35 seconds into video)
        print("   - Recording AI Agent Tab")
        await smooth_click(page, "button:has-text('agent')")
        await page.wait_for_timeout(2000)
        
        # Scroll down slightly to see the chat
        await smooth_scroll_to(page, 0.5)
        
        # "We can ask the Gemini-powered AI..."
        await smooth_type(page, "input[placeholder='Ask the Agent...']", "Who should I captain this week?")
        await smooth_click(page, "button:has-text('Ask')") # It might just be an icon, let's hit Enter
        await page.keyboard.press("Enter")
        
        # Wait for the AI agent response simulation
        await page.wait_for_timeout(8000)
        
        # "Upgrade today..."
        await smooth_scroll_to(page, 0.0)
        await page.wait_for_timeout(3000)

        await page.close()
        await context.close()
        await browser.close()
    print("   [SUCCESS] Playwright video recording completed.")

def compile_final_video(temp_dir, narration_audio, final_output):
    print("3. Compiling final video with FFmpeg...")
    webm_files = glob.glob(os.path.join(temp_dir, "*.webm"))
    if not webm_files:
        raise FileNotFoundError("Could not find the recorded Playwright video file.")
    
    recorded_webm = webm_files[0]
    
    if os.path.exists(final_output):
        os.remove(final_output)
        
    cmd = [
        "C:\\Users\\Administrator\\Downloads\\ffmpeg\\bin\\ffmpeg.exe",
        "-y",
        "-i", recorded_webm,
        "-i", narration_audio,
        "-map", "0:v",
        "-map", "1:a",
        "-vf", "scale=1920:1080",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-shortest",
        final_output
    ]
    
    subprocess.run(cmd, check=True)
    print(f"   [SUCCESS] Final presentation compiled: {final_output}")

def main():
    narration_audio = "narration.mp3"
    temp_video_dir = "video_temp"
    final_output = "fpl_optimizer_demo.mp4"
    html_path = "index.html"
    
    try:
        generate_voiceover(VOICEOVER_TEXT, narration_audio)
        asyncio.run(record_walkthrough(html_path, temp_video_dir))
        compile_final_video(temp_video_dir, narration_audio, final_output)
        
        if os.path.exists(temp_video_dir):
            shutil.rmtree(temp_video_dir)
        if os.path.exists(narration_audio):
            os.remove(narration_audio)
            
        print(f"\\n=======================================================")
        print(f"DEMO VIDEO COMPILATION COMPLETE!")
        print(f"File created: {os.path.abspath(final_output)}")
        print(f"=======================================================")
        
    except Exception as e:
        print(f"\\n[ERROR] Video generation failed: {e}")

if __name__ == "__main__":
    main()
