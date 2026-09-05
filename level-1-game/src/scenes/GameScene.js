import Phaser from 'phaser';

/**
 * Coordinates are in the original 1920x1080 click space.
 * Click the room (Dev Mode) and paste { x, y } here.
 */
const ITEMS = [
  { key: 'banana', x: 582, y: 229, size: 68, angle: -18 },
  { key: 'mouse', x: 1198, y: 179, size: 76, angle: 6 },
  { key: 'glasses', x: 1747, y: 536, size: 100, angle: -38 },
  { key: 'apple', x: 1169, y: 676, size: 54, angle: 12 },
  { key: 'usb', x: 1523, y: 876, size: 62, angle: -18 },
  { key: 'pencil', x: 505, y: 752, size: 82, angle: 68 },
];

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const PANEL_HEIGHT = 150;
const HUD_ICON_SIZE = 120;

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  preload() {
    this.load.on('loaderror', (fileObj) => {
      console.error('Phaser не нашел файл:', fileObj.key, 'по пути:', fileObj.src);
    });

    this.load.image('bg', '/assets/bg.jpg');
    this.load.image('banana', '/assets/banana.png');
    this.load.image('mouse', '/assets/mouse.png');
    this.load.image('glasses', '/assets/glasses.png');
    this.load.image('apple', '/assets/apple.png');
    this.load.image('usb', '/assets/usb.png');
    this.load.image('pencil', '/assets/pencil.png');
  }

  create() {
    this.foundCount = 0;
    this.totalCount = ITEMS.length;
    this.hudSlots = {};

    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    const playWidth = width;
    const playHeight = height - PANEL_HEIGHT;

    this.cameras.main.setBackgroundColor('#000000');

    const bgSource = this.textures.get('bg').getSourceImage();
    const fitScaleValue = Math.min(
      playWidth / bgSource.width,
      playHeight / bgSource.height,
    );
    const bgWidth = bgSource.width * fitScaleValue;
    const bgHeight = bgSource.height * fitScaleValue;
    const bgX = (playWidth - bgWidth) / 2;
    const bgY = (playHeight - bgHeight) / 2;

    this.bgX = bgX;
    this.bgY = bgY;
    this.bgWidth = bgWidth;
    this.bgHeight = bgHeight;

    const bg = this.add.image(bgX, bgY, 'bg').setOrigin(0, 0);
    bg.setDisplaySize(bgWidth, bgHeight);
    bg.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, bgWidth, bgHeight),
      Phaser.Geom.Rectangle.Contains,
    );
    bg.on('pointerdown', (pointer) => {
      const localX = pointer.worldX - bgX;
      const localY = pointer.worldY - bgY;

      if (
        localX < 0 ||
        localY < 0 ||
        localX > bgWidth ||
        localY > bgHeight
      ) {
        return;
      }

      this.showClickCoords(
        Math.round((localX / bgWidth) * DESIGN_WIDTH),
        Math.round((localY / bgHeight) * DESIGN_HEIGHT),
        pointer.worldX,
        pointer.worldY,
      );
    });

    this.createHud(width, height);

    for (const item of ITEMS) {
      const sprite = this.add.image(
        this.toPlayX(item.x),
        this.toPlayY(item.y),
        item.key,
      );
      sprite.setScale(fitScale(sprite, this.toPlaySize(item.size)));
      sprite.setAngle(item.angle);
      sprite.setDepth(10);
      sprite.setData('itemKey', item.key);
      sprite.setInteractive({ useHandCursor: true });

      sprite.on('pointerdown', () => {
        this.collectItem(sprite);
      });
    }
  }

  toPlayX(x) {
    return this.bgX + (x / DESIGN_WIDTH) * this.bgWidth;
  }

  toPlayY(y) {
    return this.bgY + (y / DESIGN_HEIGHT) * this.bgHeight;
  }

  toPlaySize(size) {
    return size * (this.bgWidth / DESIGN_WIDTH);
  }

  createHud(width, height) {
    const panelY = height - PANEL_HEIGHT / 2;

    const panel = this.add.rectangle(
      width / 2,
      panelY,
      width,
      PANEL_HEIGHT,
      0xe7d7c2,
      1,
    );
    panel.setDepth(1000);
    panel.setInteractive();

    this.add
      .rectangle(width / 2, height - PANEL_HEIGHT, width, 6, 0x8b7355, 1)
      .setDepth(1001);

    const slotCount = ITEMS.length;
    const slotGap = 200;
    const slotsWidth = (slotCount - 1) * slotGap;
    const startX = width / 2 - slotsWidth / 2 - 50;

    ITEMS.forEach((item, index) => {
      const x = startX + index * slotGap;
      const y = panelY;

      const icon = this.add.image(x, y, item.key);
      const scale = fitScale(icon, HUD_ICON_SIZE);
      icon.setScale(scale);
      icon.setDepth(1002);
      icon.setAlpha(0.4);

      this.hudSlots[item.key] = { icon, x, y, hudScale: scale };
    });

    this.counterText = this.add
      .text(width - 48, panelY, `0/${this.totalCount}`, {
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '42px',
        fontStyle: 'bold',
        color: '#3b332b',
      })
      .setOrigin(1, 0.5)
      .setDepth(1002);
  }

  showClickCoords(designX, designY, screenX, screenY) {
    const coords = { x: designX, y: designY };
    console.log(coords);

    const label = this.add
      .text(screenX, screenY, `{ x: ${designX}, y: ${designY} }`, {
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '22px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 5,
      })
      .setOrigin(0.5, 1)
      .setDepth(3000);

    this.time.delayedCall(1000, () => {
      label.destroy();
    });
  }

  collectItem(sprite) {
    if (sprite.getData('collecting')) {
      return;
    }

    sprite.setData('collecting', true);
    sprite.disableInteractive();

    const key = sprite.getData('itemKey');
    const target = this.hudSlots[key];
    sprite.setDepth(1100);

    this.tweens.add({
      targets: sprite,
      x: target.x,
      y: target.y,
      scale: target.hudScale,
      angle: 0,
      duration: 650,
      ease: 'Cubic.easeInOut',
      onComplete: () => {
        sprite.destroy();
        target.icon.setAlpha(1);
        this.foundCount += 1;
        this.counterText.setText(`${this.foundCount}/${this.totalCount}`);
      },
    });
  }
}

function fitScale(sprite, maxSize) {
  return Math.min(maxSize / sprite.width, maxSize / sprite.height);
}
