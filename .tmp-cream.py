from PIL import Image
import collections
p=r"C:\Users\ADMINI~1\AppData\Local\Temp\orca-paste-1784980955371-1ef68cb6-90c1-445b-8a5f-17b51ec9c131.png"
im=Image.open(p).convert("RGB")
# cream node region roughly from earlier zoom analysis - the yellow fill area
# From full image: cream bubble around center-left
# Sample region 70-130 x, 40-100 y
region=im.crop((70,35,130,100))
region.resize((region.width*5, region.height*5), Image.NEAREST).save(r"D:\BaiduSyncdisk\Memory Anki\.tmp-screenshots\cream-5x.png")
# color of text-like dark pixels in that region
darks=[]
creams=[]
for y in range(region.height):
  for x in range(region.width):
    r,g,b=region.getpixel((x,y))
    if r+g+b < 300 and max(r,g,b)-min(r,g,b)>20:
      darks.append((r,g,b))
    if r>200 and g>180 and b>100 and b<200:
      creams.append((r,g,b))
print("dark samples", collections.Counter(darks).most_common(8))
print("cream samples", collections.Counter(creams).most_common(5))
# Also check if brown handwritten (r>g>b, medium)
browns=[c for c in darks if c[0]>80 and c[0]>c[2]+20]
print("brown-ish", collections.Counter(browns).most_common(5), "count", len(browns))
grays=[c for c in darks if abs(c[0]-c[1])<15 and abs(c[1]-c[2])<15]
print("gray-ish", collections.Counter(grays).most_common(5), "count", len(grays))
