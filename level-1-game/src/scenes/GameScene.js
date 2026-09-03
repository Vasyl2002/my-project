import Phaser from 'phaser';

/**
 * Coordinates are in game pixels (1920x1080).
 * Click the background (Dev Mode) and paste { x, y } here.
 */
const ITEMS = [
  { key: 'banana', x: 582, y: 229, size: 78, angle: -32 },
  { key: 'mouse', x: 1198, y: 179, size: 70, angle: 10 },
  { key: 'glasses', x: 1747, y: 536, size: 92, angle: -24 },
  { key: 'apple', x: 1169, y: 676, size: 62, angle: 16 },
  { key: 'usb', x: 1523, y: 876, size: 48, angle: 8 },
  { key: 'pencil', x: 457, y: 734, size: 88, angle: 58 },
];

const PANEL_HEIGHT = 110;
const HUD_ICON_SIZE = 56;

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

    const bg = this.add.image(0, 0, 'bg').setOrigin(0, 0);
    bg.setDisplaySize(width, height);
    bg.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, width, height),
      Phaser.Geom.Rectangle.Contains,
    );
    bg.on('pointerdown', (pointer) => {
      this.showClickCoords(
        Math.round(pointer.worldX),
        Math.round(pointer.worldY),
      );
    });

    this.createHud(width, height);

    for (const item of ITEMS) {
      const sprite = this.add.image(item.x, item.y, item.key);
      sprite.setScale(fitScale(sprite, item.size));
      sprite.setAngle(item.angle);
      sprite.setDepth(10);
      sprite.setData('itemKey', item.key);
      sprite.setInteractive({ useHandCursor: true });

      sprite.on('pointerdown', () => {
        this.collectItem(sprite);
      });
    }
  }

  createHud(width, height) {
    const panelY = height - PANEL_HEIGHT / 2;

    const panel = this.add.rectangle(
      width / 2,
      panelY,
      width,
      PANEL_HEIGHT,
      0xf4efe6,
      0.96,
    );
    panel.setDepth(1000);

    const slotCount = ITEMS.length;
    const slotGap = 88;
    const slotsWidth = (slotCount - 1) * slotGap;
    const startX = width / 2 - slotsWidth / 2 - 40;

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
      .text(width - 36, panelY, `0/${this.totalCount}`, {
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '32px',
        fontStyle: 'bold',
        color: '#3b332b',
      })
      .setOrigin(1, 0.5)
      .setDepth(1002);
  }

  showClickCoords(x, y) {
    const coords = { x, y };
    console.log(coords);

    const label = this.add
      .text(x, y, `{ x: ${x}, y: ${y} }`, {
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
