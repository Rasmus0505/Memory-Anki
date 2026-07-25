from PIL import Image
p=r"C:\Users\ADMINI~1\AppData\Local\Temp\orca-paste-1784980955371-1ef68cb6-90c1-445b-8a5f-17b51ec9c131.png"
im=Image.open(p).convert("RGB")
# cream toolbar region - get exact bounds of amber-100 colored pixels
xs=[]; ys=[]
for y in range(im.height):
  for x in range(im.width):
    r,g,b=im.getpixel((x,y))
    # amber-100-ish
    if 240<=r<=255 and 230<=g<=250 and 180<=b<=210:
      xs.append(x); ys.append(y)
print("amber-100 bbox", min(xs), min(ys), max(xs), max(ys), "w", max(xs)-min(xs), "h", max(ys)-min(ys), "count", len(xs))
# crop just that
l,t,r,b=min(xs)-2,min(ys)-2,max(xs)+2,max(ys)+2
im.crop((l,t,r,b)).resize(((r-l)*6,(b-t)*6), Image.NEAREST).save(r"D:\BaiduSyncdisk\Memory Anki\.tmp-screenshots\toolbar-only.png")
print("toolbar crop", l,t,r,b)
