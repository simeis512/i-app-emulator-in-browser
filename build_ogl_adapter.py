# SPDX-License-Identifier: GPL-3.0-or-later
"""Generated parts of the com.nttdocomo.ui.Graphics adapter that build_ogl.py writes."""

# With the GPU renderer, the CPU picture can lag behind GPU drawing that is not read back yet. Every 2D call on the
# adapter first lets that drawing come back (and a write marks the picture changed); images drawn from are synchronised
# as sources the same way. (name, parameters, call arguments, source image expression or None, writes)
CPU_ACCESS=[
    ('drawImage','com.nttdocomo.ui.Image image, int x, int y','image, x, y','image',True),
    ('drawImage','com.nttdocomo.ui.Image image, int dx, int dy, int sx, int sy, int width, int height','image, dx, dy, sx, sy, width, height','image',True),
    ('drawImage','com.nttdocomo.ui.Image image, int[] matrix','image, matrix','image',True),
    ('drawImage','com.nttdocomo.ui.Image image, int[] matrix, int sx, int sy, int width, int height','image, matrix, sx, sy, width, height','image',True),
    ('drawScaledImage','com.nttdocomo.ui.Image image, int dx, int dy, int width, int height, int sx, int sy, int swidth, int sheight','image, dx, dy, width, height, sx, sy, swidth, sheight','image',True),
    ('drawString','String str, int x, int y','str, x, y',None,True),
    ('drawChars','char[] data, int x, int y, int offset, int length','data, x, y, offset, length',None,True),
    ('fillRect','int x, int y, int width, int height','x, y, width, height',None,True),
    ('drawRect','int x, int y, int width, int height','x, y, width, height',None,True),
    ('clearRect','int x, int y, int width, int height','x, y, width, height',None,True),
    ('drawLine','int x1, int y1, int x2, int y2','x1, y1, x2, y2',None,True),
    ('fillPolygon','int[] xPoints, int[] yPoints, int numPoints','xPoints, yPoints, numPoints',None,True),
    ('fillPolygon','int[] xPoints, int[] yPoints, int offset, int numPoints','xPoints, yPoints, offset, numPoints',None,True),
    ('drawPolyline','int[] xPoints, int[] yPoints, int nPoints','xPoints, yPoints, nPoints',None,True),
    ('drawPolyline','int[] xPoints, int[] yPoints, int offset, int count','xPoints, yPoints, offset, count',None,True),
    ('fillArc','int x, int y, int width, int height, int startAngle, int arcAngle','x, y, width, height, startAngle, arcAngle',None,True),
    ('drawArc','int x, int y, int width, int height, int startAngle, int arcAngle','x, y, width, height, startAngle, arcAngle',None,True),
    ('drawSpriteSet','com.nttdocomo.ui.SpriteSet sprites','sprites',None,True),
    ('drawImageMap','com.nttdocomo.ui.ImageMap map, int x, int y','map, x, y',None,True),
    ('setPixel','int x, int y','x, y',None,True),
    ('setPixel','int x, int y, int color','x, y, color',None,True),
    ('setPixels','int x, int y, int width, int height, int[] array, int offset','x, y, width, height, array, offset',None,True),
    ('copyArea','int x, int y, int width, int height, int dx, int dy','x, y, width, height, dx, dy',None,True),
    ('unlock','boolean forced','forced',None,False),
]
CPU_READS=[
    ('int','getPixel','int x, int y','x, y'),
    ('int','getRGBPixel','int x, int y','x, y'),
    ('int[]','getPixels','int x, int y, int width, int height, int[] array, int offset','x, y, width, height, array, offset'),
    ('int[]','getRGBPixels','int x, int y, int width, int height, int[] array, int offset','x, y, width, height, array, offset'),
]
CPU_SYNC=''.join(
    f'    public void {name}({params}) {{ '
    +(f'if({source}!=null) OglRenderer.gpuCpuAccess({source}.getCanvas(), false); ' if source else '')
    +f'OglRenderer.gpuCpuAccess(picture, {str(writes).lower()}); super.{name}({args}); }}\n'
    for name,params,args,source,writes in CPU_ACCESS)+''.join(
    f'    public {result} {name}({params}) {{ OglRenderer.gpuCpuAccess(picture, false); return super.{name}({args}); }}\n'
    for result,name,params,args in CPU_READS)
