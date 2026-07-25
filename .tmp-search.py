from PIL import Image
p=r"C:\Users\ADMINI~1\AppData\Local\Temp\orca-paste-1784980955371-1ef68cb6-90c1-445b-8a5f-17b51ec9c131.png"
im=Image.open(p).convert("RGB")
# Check the red search button color precisely
# From reality crop, red is in lower portion
region=im.crop((95,120,145,175))
region.resize((region.width*6, region.height*6), Image.NEAREST).save(r"D:\BaiduSyncdisk\Memory Anki\.tmp-screenshots\search-btn.png")
from collections import Counter
c=Counter()
for y in range(region.height):
  for x in range(region.width):
    px=region.getpixel((x,y))
    c[(px[0]//8*8,px[1]//8*8,px[2]//8*8)]+=1
print(c.most_common(15))
