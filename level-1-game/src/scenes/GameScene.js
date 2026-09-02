import Phaser from 'phaser';

/**
 * Hidden-object item list.
 * Coordinates are in background-image pixels. Click the scene background
 * (Dev Mode) and paste { x, y } here after you drop in the real assets.
 */
const ITEMS = [
  { key: 'banana', file: 'banana.png', x: 210, y: 250 },
  { key: 'mouse', file: 'mouse.png', x: 620, y: 390 },
  { key: 'glasses', file: 'glasses.png', x: 980, y: 175 },
  { key: 'apple', file: 'apple.png', x: 340, y: 480 },
  { key: 'usb', file: 'usb.png', x: 860, y: 455 },
  { key: 'pencil', file: 'pencil.png', x: 1090, y: 310 },
];

const PANEL_HEIGHT = 110;
const HUD_ICON_SIZE = 56;

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  preload() {
    this.load.image('bg', 'assets/bg.jpg');

    for (const item of ITEMS) {
      this.load.image(item.key, `assets/${item.file}`);
    }
  }

  create() {
    this.foundCount = 0;
    this.totalCount = ITEMS.length;
    this.hudSlots = {};

    const bgSource = this.textures.get('bg').getSourceImage();
    const width = bgSource.width;
    const height = bgSource.height;

    if (width !== this.scale.width || height !== this.scale.height) {
      this.scale.setGameSize(width, height);
    }

    this.cameras.main.setBounds(0, 0, width, height);
    this.cameras.main.centerOn(width / 2, height / 2);

    const bg = this.add.image(width / 2, height / 2, 'bg');
    bg.setInteractive({ useHandCursor: false });
    bg.on('pointerdown', (pointer) => {
      console.log({
        x: Math.round(pointer.worldX),
        y: Math.round(pointer.worldY),
      });
    });

    this.createHud(width, height);
    this.spawnItems();
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
    panel.setStrokeStyle(2, 0xd9d0c3);

    const slotCount = ITEMS.length;
    const slotGap = 88;
    const slotsWidth = (slotCount - 1) * slotGap;
    const startX = width / 2 - slotsWidth / 2 - 40;

    ITEMS.forEach((item, index) => {
      const x = startX + index * slotGap;
      const y = panelY;

      const slot = this.add.circle(x, y, 34, 0xffffff, 1);
      slot.setStrokeStyle(2, 0xcfc4b5);
      slot.setDepth(1001);

      const icon = this.add.image(x, y, item.key);
      fitSprite(icon, HUD_ICON_SIZE);
      icon.setDepth(1002);
      icon.setAlpha(0.38);
      icon.setTint(0x7a7a7a);

      this.hudSlots[item.key] = { slot, icon, x, y };
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

  spawnItems() {
    for (const item of ITEMS) {
      const sprite = this.add.image(item.x, item.y, item.key);
      sprite.setDepth(10);
      sprite.setData('itemKey', item.key);
      sprite.setInteractive({ useHandCursor: true, pixelPerfect: false });

      sprite.on('pointerdown', () => {
        this.collectItem(sprite);
      });
    }
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
      scale: getHudScale(sprite),
      duration: 650,
      ease: 'Cubic.easeInOut',
      onComplete: () => {
        sprite.destroy();
        this.markHudFound(key);
        this.foundCount += 1;
        this.counterText.setText(`${this.foundCount}/${this.totalCount}`);

        if (this.foundCount >= this.totalCount) {
          this.showWinMessage();
        }
      },
    });
  }

  markHudFound(key) {
    const { icon, slot } = this.hudSlots[key];
    icon.clearTint();
    icon.setAlpha(1);
    slot.setFillStyle(0xe5f6d8);
    slot.setStrokeStyle(2, 0x7cb86a);
  }

  showWinMessage() {
    const { width, height } = this.scale;

    const overlay = this.add.rectangle(
      width / 2,
      height / 2,
      width,
      height,
      0x000000,
      0.45,
    );
    overlay.setDepth(2000);

    this.add
      .text(width / 2, height / 2, 'You found everything!', {
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '48px',
        fontStyle: 'bold',
        color: '#ffffff',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(2001);
  }
}

function fitSprite(sprite, maxSize) {
  const scale = Math.min(maxSize / sprite.width, maxSize / sprite.height);
  sprite.setScale(scale);
}

function getHudScale(sprite) {
  return Math.min(HUD_ICON_SIZE / sprite.width, HUD_ICON_SIZE / sprite.height);
}
