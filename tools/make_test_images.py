import subprocess, os
from PIL import Image, ImageDraw, ImageFont
out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'work', 'testimg'); os.makedirs(out, exist_ok=True)
fp = subprocess.run(['fc-match', '-f', '%{file}', 'Gothic A1:bold'], capture_output=True, text=True).stdout
F = lambda s: ImageFont.truetype(fp, s)
im = Image.new('RGB', (3000, 2000)); d = ImageDraw.Draw(im)
for y in range(2000): d.line([(0, y), (3000, y)], fill=(40 + y // 20, 90, 160 - y // 25))
d.rectangle([300, 500, 2700, 1500], outline='white', width=12)
d.text((420, 800), '테스트 현장 사진 (가짜)', font=F(170), fill='white'); im.save(f'{out}/site1.jpg', quality=90)
im2 = im.transpose(Image.FLIP_LEFT_RIGHT); ImageDraw.Draw(im2).text((420, 1150), '부스 전경 2', font=F(150), fill='yellow'); im2.save(f'{out}/site2.jpg', quality=90)
c = Image.new('RGB', (2400, 1400), 'white'); d = ImageDraw.Draw(c)
d.rectangle([0, 0, 2400, 120], fill=(31, 58, 95))
d.text((120, 300), '홍길동  과장', font=F(150), fill='black'); d.text((120, 560), '(주)테스트로보틱스 · 샘플', font=F(100), fill=(60, 60, 60))
d.text((120, 800), 'TEL 000-0000-0000 (가짜)', font=F(90), fill=(60, 60, 60)); d.text((120, 960), 'test@example.com', font=F(90), fill=(60, 60, 60))
c.save(f'{out}/card1.jpg', quality=90); print('ok', out)
