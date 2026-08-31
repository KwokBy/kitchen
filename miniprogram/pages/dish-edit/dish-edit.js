const { loadState, updateState } = require('../../services/store');
const { formatDate } = require('../../utils/date');
const { compareIngredients } = require('../../utils/ingredients');
const { planDatesOf } = require('../../utils/schedule');

Page({
  data: {
    dishId: '',
    title: '新增一道菜',
    categories: [],
    categoryIndex: 0,
    name: '',
    image: '/assets/dishes/dish-1.png',
    showCropper: false,
    cropSource: '',
    cropImageStyle: '',
    cropZoom: 100,
    cropSaving: false,
    plate: 'sage',
    plateOptions: [
      { key: 'sage', label: '青瓷', image: '/assets/plates/sage.png' },
      { key: 'cream', label: '米釉', image: '/assets/plates/cream.png' },
      { key: 'pink', label: '花点', image: '/assets/plates/pink.png' },
      { key: 'blue', label: '云边', image: '/assets/plates/blue.png' }
    ],
    wantedBy: ['partner'],
    meWanted: false,
    partnerWanted: true,
    today: '',
    planDate: '',
    planDates: [],
    note: '',
    ingredientsText: '',
    ingredientChecks: [],
    inventory: []
  },
  onLoad(options) {
    const state = loadState();
    const dish = options.id ? state.dishes.find(item => item.id === options.id) : null;
    const categoryIndex = dish ? Math.max(0, state.categories.indexOf(dish.category)) : 0;
    this.setData({
      dishId: dish ? dish.id : '',
      title: dish ? '编辑这道菜' : '新增一道菜',
      categories: state.categories,
      categoryIndex,
      name: dish ? dish.name : '',
      image: dish ? dish.image : '/assets/dishes/dish-1.png',
      plate: dish && dish.plate ? dish.plate : 'sage',
      wantedBy: dish ? dish.wantedBy : ['partner'],
      meWanted: dish ? dish.wantedBy.includes('me') : false,
      partnerWanted: dish ? dish.wantedBy.includes('partner') : true,
      today: formatDate(new Date()),
      planDate: options.planDate || '',
      planDates: dish ? planDatesOf(dish) : [],
      note: dish ? dish.note : '',
      ingredientsText: dish ? dish.ingredients.join('\n') : '',
      inventory: state.inventory || []
    });
    this.refreshIngredientChecks(this.data.ingredientsText);
    wx.setNavigationBarTitle({ title: this.data.title });
  },
  onCategoryChange(event) { this.setData({ categoryIndex: Number(event.detail.value) }); },
  onPlanDateChange(event) { this.setData({ planDate: event.detail.value }); },
  clearPlanDate() { this.setData({ planDate: '' }); },
  toggleWanted(event) {
    const person = event.currentTarget.dataset.person;
    const wantedBy = this.data.wantedBy.includes(person)
      ? this.data.wantedBy.filter(item => item !== person)
      : [...this.data.wantedBy, person];
    this.setData({ wantedBy, meWanted: wantedBy.includes('me'), partnerWanted: wantedBy.includes('partner') });
  },
  selectPlate(event) { this.setData({ plate: event.currentTarget.dataset.plate }); },
  onIngredientsInput(event) {
    const ingredientsText = event.detail.value;
    this.setData({ ingredientsText });
    this.refreshIngredientChecks(ingredientsText);
  },
  refreshIngredientChecks(text) {
    const lines = String(text || '').split('\n').map(item => item.trim()).filter(Boolean);
    this.setData({ ingredientChecks: compareIngredients(lines, this.data.inventory) });
  },
  chooseImage(event) {
    const source = event.currentTarget.dataset.source;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [source],
      success: result => {
        const src = result.tempFiles[0].tempFilePath;
        this.openImageCropper(src);
      }
    });
  },
  openImageCropper(src) {
    wx.getImageInfo({
      src,
      success: info => {
        const windowWidth = wx.getWindowInfo ? wx.getWindowInfo().windowWidth : wx.getSystemInfoSync().windowWidth;
        const cropSize = windowWidth * 560 / 750;
        const aspect = info.width / info.height;
        const baseWidth = aspect >= 1 ? cropSize * aspect : cropSize;
        const baseHeight = aspect >= 1 ? cropSize : cropSize / aspect;
        const crop = {
          size: cropSize,
          naturalWidth: info.width,
          naturalHeight: info.height,
          baseWidth,
          baseHeight,
          scale: 1,
          x: (cropSize - baseWidth) / 2,
          y: (cropSize - baseHeight) / 2,
          stageLeft: 0,
          stageTop: 0
        };
        this.cropState = crop;
        this.setData({ showCropper: true, cropSource: src, cropSaving: false, cropZoom: 100, cropImageStyle: this.cropStyle(crop) }, () => {
          this.createSelectorQuery().select('.crop-stage').boundingClientRect(rect => {
            if (rect && this.cropState) {
              this.cropState.stageLeft = rect.left;
              this.cropState.stageTop = rect.top;
            }
          }).exec();
        });
      },
      fail: () => wx.showToast({ title: '这张图片暂时无法读取', icon: 'none' })
    });
  },
  cropStyle(crop) {
    return `left:${crop.x}px;top:${crop.y}px;width:${crop.baseWidth * crop.scale}px;height:${crop.baseHeight * crop.scale}px;`;
  },
  clampCrop(crop, x, y, scale) {
    const width = crop.baseWidth * scale;
    const height = crop.baseHeight * scale;
    return {
      x: Math.min(0, Math.max(crop.size - width, x)),
      y: Math.min(0, Math.max(crop.size - height, y))
    };
  },
  cropTouchPoint(touch) {
    return {
      x: touch.clientX !== undefined ? touch.clientX : (touch.pageX !== undefined ? touch.pageX : touch.x),
      y: touch.clientY !== undefined ? touch.clientY : (touch.pageY !== undefined ? touch.pageY : touch.y)
    };
  },
  onCropTouchStart(event) {
    const crop = this.cropState;
    if (!crop) return;
    const touches = event.touches.map(touch => this.cropTouchPoint(touch));
    if (touches.length >= 2) {
      const midpoint = { x: (touches[0].x + touches[1].x) / 2, y: (touches[0].y + touches[1].y) / 2 };
      this.cropGesture = {
        type: 'pinch',
        distance: Math.hypot(touches[0].x - touches[1].x, touches[0].y - touches[1].y),
        scale: crop.scale,
        focalX: (midpoint.x - crop.stageLeft - crop.x) / (crop.baseWidth * crop.scale),
        focalY: (midpoint.y - crop.stageTop - crop.y) / (crop.baseHeight * crop.scale)
      };
    } else if (touches.length === 1) {
      this.cropGesture = { type: 'drag', point: touches[0], x: crop.x, y: crop.y };
    }
  },
  onCropTouchMove(event) {
    const crop = this.cropState;
    const gesture = this.cropGesture;
    if (!crop || !gesture) return;
    const touches = event.touches.map(touch => this.cropTouchPoint(touch));
    if (gesture.type === 'pinch' && touches.length >= 2) {
      const distance = Math.hypot(touches[0].x - touches[1].x, touches[0].y - touches[1].y);
      const scale = Math.min(4, Math.max(1, gesture.scale * distance / Math.max(1, gesture.distance)));
      const midpoint = {
        x: (touches[0].x + touches[1].x) / 2 - crop.stageLeft,
        y: (touches[0].y + touches[1].y) / 2 - crop.stageTop
      };
      const position = this.clampCrop(crop, midpoint.x - gesture.focalX * crop.baseWidth * scale, midpoint.y - gesture.focalY * crop.baseHeight * scale, scale);
      Object.assign(crop, position, { scale });
    } else if (gesture.type === 'drag' && touches.length === 1) {
      const position = this.clampCrop(crop, gesture.x + touches[0].x - gesture.point.x, gesture.y + touches[0].y - gesture.point.y, crop.scale);
      Object.assign(crop, position);
    }
    this.setData({ cropZoom: Math.round(crop.scale * 100), cropImageStyle: this.cropStyle(crop) });
  },
  onCropTouchEnd(event) {
    this.cropGesture = null;
    if (event.touches.length === 1) this.onCropTouchStart(event);
  },
  closeImageCropper() {
    if (this.data.cropSaving) return;
    this.cropState = null;
    this.cropGesture = null;
    this.setData({ showCropper: false, cropSource: '' });
  },
  onCropZoomChange(event) {
    const crop = this.cropState;
    if (!crop) return;
    const scale = Math.min(4, Math.max(1, Number(event.detail.value) / 100));
    const center = crop.size / 2;
    const oldWidth = crop.baseWidth * crop.scale;
    const oldHeight = crop.baseHeight * crop.scale;
    const focalX = (center - crop.x) / oldWidth;
    const focalY = (center - crop.y) / oldHeight;
    const position = this.clampCrop(crop, center - focalX * crop.baseWidth * scale, center - focalY * crop.baseHeight * scale, scale);
    Object.assign(crop, position, { scale });
    this.setData({ cropZoom: Math.round(scale * 100), cropImageStyle: this.cropStyle(crop) });
  },
  confirmImageCrop() {
    const crop = this.cropState;
    if (!crop || this.data.cropSaving) return;
    this.setData({ cropSaving: true });
    this.createSelectorQuery().select('#dishCropCanvas').fields({ node: true, size: true }).exec(result => {
      const canvas = result[0] && result[0].node;
      if (!canvas) return this.cropFailed();
      const outputSize = 512;
      canvas.width = outputSize;
      canvas.height = outputSize;
      const context = canvas.getContext('2d');
      const image = canvas.createImage();
      image.onload = () => {
        const renderWidth = crop.baseWidth * crop.scale;
        const renderHeight = crop.baseHeight * crop.scale;
        const sourceX = -crop.x / renderWidth * crop.naturalWidth;
        const sourceY = -crop.y / renderHeight * crop.naturalHeight;
        const sourceWidth = crop.size / renderWidth * crop.naturalWidth;
        const sourceHeight = crop.size / renderHeight * crop.naturalHeight;
        context.clearRect(0, 0, outputSize, outputSize);
        context.save();
        context.beginPath();
        context.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
        context.clip();
        context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputSize, outputSize);
        context.restore();
        wx.canvasToTempFilePath({
          canvas,
          fileType: 'png',
          width: outputSize,
          height: outputSize,
          destWidth: outputSize,
          destHeight: outputSize,
          success: exported => {
            this.persistImage(exported.tempFilePath);
            this.cropState = null;
            this.cropGesture = null;
            this.setData({ showCropper: false, cropSource: '', cropSaving: false });
          },
          fail: () => this.cropFailed()
        });
      };
      image.onerror = () => this.cropFailed();
      image.src = this.data.cropSource;
    });
  },
  cropFailed() {
    this.setData({ cropSaving: false });
    wx.showToast({ title: '裁剪失败，请换一张图片重试', icon: 'none' });
  },
  persistImage(tempFilePath) {
    wx.saveFile({
      tempFilePath,
      success: result => this.setData({ image: result.savedFilePath }),
      fail: () => this.setData({ image: tempFilePath })
    });
  },
  saveDish(event) {
    const values = event.detail.value;
    const name = values.name.trim();
    if (!name) return wx.showToast({ title: '先写菜名', icon: 'none' });
    if (!this.data.wantedBy.length) return wx.showToast({ title: '至少标记一个人想吃', icon: 'none' });
    const dish = {
      id: this.data.dishId || `d-${Date.now()}`,
      name,
      category: this.data.categories[this.data.categoryIndex],
      wantedBy: this.data.wantedBy,
      image: this.data.image,
      plate: this.data.plate,
      note: values.note.trim(),
      planDates: [...new Set([...this.data.planDates, this.data.planDate].filter(Boolean))].sort(),
      ingredients: values.ingredients.split('\n').map(item => item.trim()).filter(Boolean)
    };
    updateState(state => {
      const index = state.dishes.findIndex(item => item.id === dish.id);
      if (index >= 0) state.dishes[index] = dish;
      else state.dishes.push(dish);
    });
    wx.showToast({ title: this.data.dishId ? '菜已更新' : '菜已添加', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 350);
  }
});
