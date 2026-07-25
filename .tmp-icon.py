from PIL import Image
# Look at search button more carefully - is it really a magnifying glass?
p=r"C:\Users\ADMINI~1\AppData\Local\Temp\orca-paste-1784980955371-1ef68cb6-90c1-445b-8a5f-17b51ec9c131.png"
im=Image.open(p).convert("RGB")
# Full node area with annotation removed conceptually - save larger
im.crop((70,70,170,180)).resize((400,440), Image.LANCZOS).save(r"D:\BaiduSyncdisk\Memory Anki\.tmp-screenshots\node-area.png")
im.crop((100,125,150,170)).resize((300,270), Image.NEAREST).save(r"D:\BaiduSyncdisk\Memory Anki\.tmp-screenshots\icon-only.png")
print("saved")
