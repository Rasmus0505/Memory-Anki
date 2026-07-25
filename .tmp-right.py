from PIL import Image
import collections
p=r"C:\Users\ADMINI~1\AppData\Local\Temp\orca-paste-1784980955371-1ef68cb6-90c1-445b-8a5f-17b51ec9c131.png"
im=Image.open(p).convert("RGB")
# right node yellow highlights - around x 140-220, y 40-100
region=im.crop((130,30,220,120))
region.resize((region.width*4, region.height*4), Image.LANCZOS).save(r"D:\BaiduSyncdisk\Memory Anki\.tmp-screenshots\right-4x.png")
# yellow-ish pixels that are highlight (not pure white card)
yellows=[]
for y in range(region.height):
  for x in range(region.width):
    r,g,b=region.getpixel((x,y))
    if r>230 and g>200 and 100<b<200 and r-b>40:
      yellows.append((r,g,b))
print("yellow count", len(yellows))
print(collections.Counter(yellows).most_common(10))
# Also the 现实性 node area
n=im.crop((80,90,160,160))
n.resize((n.width*4,n.height*4), Image.LANCZOS).save(r"D:\BaiduSyncdisk\Memory Anki\.tmp-screenshots\reality-4x.png")
