import Phaser, { Scene } from "phaser";
import { socketService } from "../../services/socket.js";
import { apiUrl } from "../../utils/urls.js";
import { EventBus } from "../EventBus";
import { createPlayer, setPlayerColor } from "../utils/playerFactory.js";

const GHOST_FRAME_COUNT = 48;
const GHOST_ASSET_DIR = "/assets/sprites/Base/ghost";

const KILL_FRAME_COUNT = 64;
const KILL_SCREEN_DURATION_MS = 2500;
const KILL_IMPOSTER_DIR = "assets/sprites/Base/imposterkills/alien";
const KILL_VICTIM_DIR = "assets/sprites/Base/deaths/alien";

/**
 * Base class for shared logic of player management, movement, and socket events
 */
export class BaseGameScene extends Scene {
    constructor(key) {
        super(key);
    }

    init(data) {
        this.config = data;
        this.roomId = data?.roomId || null;
    }

    /**
     * Override in child classes, will provide scene specific map configuration
     * @returns {{ mapKey: string, mapJSON: string, tilesetName: string, tilesetKey: string, backgroundKey: string, backgroundImage: string }}
     */
    getMapConfig() {
        throw new Error("getMapConfig() must be implemented by child class");
    }

    /**
     * Common assets
     */
    preloadCommon() {
        this.load.atlas(
            "player",
            "assets/walk/texture.png",
            "assets/walk/texture.json",
        );
        this.load.image("idleImage", "assets/sprites/Base/idle.png");
    }

    /**
     * Load map specific assets based on getMapConfig()
     */
    preloadMap() {
        const config = this.getMapConfig();
        // TODO make it more dynamic to handle multiple tilesets
        this.load.image(
            config.tilesetKey,
            `assets/map/${config.tilesetKey}.png`,
        );
        this.load.image(
            config.backgroundKey,
            `assets/map/${config.backgroundImage}`,
        );
        this.load.tilemapTiledJSON(
            config.mapKey,
            `assets/map/${config.mapJSON}`,
        );
    }

    createWalkAnimation() {
        if (this.anims.exists("walk")) return;

        this.anims.create({
            key: "walk",
            frames: [
                { key: "player", frame: "Walk0001.png" },
                { key: "player", frame: "Walk0002.png" },
                { key: "player", frame: "Walk0003.png" },
                { key: "player", frame: "Walk0004.png" },
                { key: "player", frame: "Walk0005.png" },
                { key: "player", frame: "Walk0006.png" },
                { key: "player", frame: "Walk0007.png" },
                { key: "player", frame: "Walk0008.png" },
                { key: "player", frame: "Walk0009.png" },
                { key: "player", frame: "Walk0010.png" },
                { key: "player", frame: "Walk0011.png" },
                { key: "player", frame: "Walk0012.png" },
            ],
            frameRate: 12,
            repeat: -1,
        });
    }

    /**
     * Setup tilemap and collision layer
     */
    setupMap() {
        const config = this.getMapConfig();

        const map = this.make.tilemap({ key: config.mapKey });
        const tileset = map.addTilesetImage(
            config.tilesetName,
            config.tilesetKey,
        );
        const collisionLayer = map.createLayer("collisions", tileset, 0, 0);

        // The Tiled collision grid is the source of truth for world dimensions.
        // Fit the artwork to that exact grid so the collision cells and image stay aligned.
        this.background = this.add
            .image(0, 0, config.backgroundKey)
            .setOrigin(0, 0)
            .setDisplaySize(map.widthInPixels, map.heightInPixels)
            .setName("background")
            .setDepth(-10);
        this.worldContainer.add(this.background);

        // Use linear filtering for the high-resolution background.
        const backgroundTexture = this.textures.get(config.backgroundKey);
        if (backgroundTexture && backgroundTexture.setFilter) {
            backgroundTexture.setFilter(Phaser.Textures.FilterMode.LINEAR);
        }

        if (collisionLayer) {
            collisionLayer.setVisible(false);
            collisionLayer.setCollisionByExclusion([-1, 0]);
            collisionLayer.setDepth(-5);
            this.collisionLayer = collisionLayer;

            // Keep TilemapLayer on the Scene display list. Do not parent it to
            // worldContainer: Arcade Physics colliders work against the layer directly.
            if (this.physics.config.debug) {
                collisionLayer.setVisible(true);
                collisionLayer.setAlpha(0.5);
                const debugGraphics = this.add.graphics().setAlpha(0.7);
                collisionLayer.renderDebug(debugGraphics, {
                    tileColor: null,
                    collidingTileColor: new Phaser.Display.Color(
                        255,
                        0,
                        0,
                        128,
                    ),
                    faceColor: new Phaser.Display.Color(0, 255, 0, 255),
                });
            }
        }

        return { map, tileset, collisionLayer };
    }

    /**
     * Setup keyboard inputs for movement
     */
    setupInput() {
        // TODO review input handling
        this.wKey = this.input.keyboard.addKey(
            Phaser.Input.Keyboard.KeyCodes.W,
        );
        this.aKey = this.input.keyboard.addKey(
            Phaser.Input.Keyboard.KeyCodes.A,
        );
        this.sKey = this.input.keyboard.addKey(
            Phaser.Input.Keyboard.KeyCodes.S,
        );
        this.dKey = this.input.keyboard.addKey(
            Phaser.Input.Keyboard.KeyCodes.D,
        );
        this.mKey = this.input.keyboard.addKey(
            Phaser.Input.Keyboard.KeyCodes.M,
        );
    }

    /**
     * Add a player sprite to the scene
     * @param {{ id: string, x: number, y: number, color: string }} playerData
     */
    addPlayer(playerData) {
        const newPlayer = createPlayer(this, playerData, {
            addCollision: true,
            collisionLayer: this.collisionLayer,
        });
        newPlayer.id = playerData.id;
        newPlayer.alive = true;

        // Scale up sprites for lobby scene to match smaller map size
        if (this.scene.key === "WaitingLobby") {
            newPlayer.setScale(0.3);
        }

        this.players[playerData.id] = newPlayer;

        // Save spawn position
        if (!this.spawnPositions[playerData.id]) {
            this.spawnPositions[playerData.id] = {
                x: playerData.x,
                y: playerData.y,
            };
        }

        return newPlayer;
    }

    /**
     * Remove a player sprite from the scene
     * @param {string} playerId
     */
    removePlayer(playerId) {
        if (!this.players[playerId]) return;
        if (this.sys && this.sys.displayList) {
            this.players[playerId].destroy();
        }
        delete this.players[playerId];
        console.log("Players Modified", this.players);
    }

    /**
     * Fetch room data and setup players
     */
    async fetchAndSetupPlayers() {
        const playerId = sessionStorage.getItem("playerId");
        const socket = socketService.getSocket();

        console.log(
            "Fetching room data for playerId:",
            playerId,
            "socket id:",
            socket?.id,
        );

        const response = await fetch(apiUrl(`/player/room/${playerId}`));
        if (!response.ok) {
            const errBody = await response.text().catch(() => "");
            console.error(
                "Failed to fetch player room:",
                response.status,
                errBody,
            );
            return;
        }
        const data = await response.json();

        console.log("room joined data:", data);

        if (!this.sys || !this.sys.displayList) return;
        if (!data?.room || !data?.player) {
            console.error("Invalid room payload:", data);
            return;
        }

        this.room = data.room;
        this.player = this.addPlayer({
            id: data.player.id,
            x: data.player.state.x,
            y: data.player.state.y,
            color: data.player.color,
        });
        this.playerObj = data.player;
        console.log("Created own player sprite:", this.player, this.players);

        // Set camera zoom based on scene type
        const zoom = this.scene.key === "WaitingLobby" ? 1 : 2.2;

        this.cameras.main.setZoom(zoom);
        this.cameras.main.startFollow(this.player, false, 0.12, 0.12);
        this.cameras.main.ignore(this.ui);

        // Add existing players in the room
        Object.values(this.room.players).forEach((player) => {
            if (player.id === this.playerObj.id) return;
            console.log("Adding existing player:", player);
            this.addPlayer({
                id: player.id,
                x: player.state.x,
                y: player.state.y,
                color: player.color,
            });
        });
    }

    /**
     * Setup socket event listeners for player events
     */
    setupSocketListeners() {
        const socket = socketService.getSocket();
        if (!socket) return;

        // Prevent registering the same handlers multiple times
        if (this._socketListenersAdded) {
            this.socket = socket;
            return;
        }

        this.socket = socket;

        // named handlers so they can be removed later
        this._onPlayerJoined = (data) => {
            console.log("player joined", data);
            if (!this.sys || !this.sys.displayList) return;
            this.addPlayer({
                id: data.player.id,
                x: data.player.state.x,
                y: data.player.state.y,
                color: data.player.color,
            });
        };

        this._onPlayerLeft = (data) => {
            console.log("player left", data);
            this.removePlayer(data.playerId);
        };

        this._onPlayerMoved = (data) => {
            const player = this.players[data.id];
            if (!player || !player.alive) return;

            if (data.id !== this.playerObj?.id) {
                player.x = data.x;
                player.y = data.y;
            }

            if (data.d) player.flipX = data.d === "left";

            if (!player.anims) return;
            if (data.moving) {
                if (!player.anims.isPlaying) player.anims.play("walk");
            } else {
                player.anims.stop();
                player.setTexture("idleImage");
            }
        };

        socket.on("player:joined", this._onPlayerJoined);
        socket.on("player:left", this._onPlayerLeft);
        socket.on("player:moved", this._onPlayerMoved);

        this._socketListenersAdded = true;
    }

    /**
     * Cleanup socket listeners
     */
    cleanupSocketListeners() {
        if (this.socket && this._socketListenersAdded) {
            // Remove only the handlers we added
            if (this._onPlayerJoined)
                this.socket.off("player:joined", this._onPlayerJoined);
            if (this._onPlayerLeft)
                this.socket.off("player:left", this._onPlayerLeft);
            if (this._onPlayerMoved)
                this.socket.off("player:moved", this._onPlayerMoved);

            // clear refs
            this._onPlayerJoined = null;
            this._onPlayerLeft = null;
            this._onPlayerMoved = null;
            this._socketListenersAdded = false;
        }
    }

    /**
     * Common create logic for all game scenes
     */
    async createCommon() {
        this.events.once("shutdown", this.shutdown, this);
        this.ui = this.add.container(0, 0).setScrollFactor(0).setDepth(1000);
        this.worldContainer = this.add.container(0, 0).setDepth(0);
        this.players = {};
        this.ghosts = {};
        this.spawnPositions = {};
        // Track spawn positions for each player
        const uiCam = this.cameras.add(
            0,
            0,
            this.scale.width,
            this.scale.height,
        );
        uiCam.setScroll(0, 0);
        uiCam.setZoom(1);
        uiCam.ignore(this.worldContainer);

        this.cameras.main.ignore(this.ui);

        this.createWalkAnimation();
        this.createGhostAnimation();
        this.createKillAnimations();
        this.setupMap();
        this.setupInput();
        // Khi focus ô chat, phím đang giữ sẽ không nhận được keyup -> reset để nhân vật không tự đi
        this._onChatFocus = () => this.input.keyboard?.resetKeys();
        EventBus.on("chat:focus", this._onChatFocus);
        this.setupSocketListeners();
        await this.fetchAndSetupPlayers();
        console.log("Finished Setting Up Players: ", this.player);
        EventBus.emit("current-scene-ready", this);
    }

    /**
     * Handle player movement (call in update)
     */
    handleMovement() {
        if (!this.player || !this.player.body) return;

        // Freeze the local player during meetings and while the quiz modal is open.
        if (this.meetingActive || this.taskModalOpen) {
            this.player.body.setVelocity(0, 0);
            if (!this.isGhost && this.player.anims.isPlaying) {
                this.player.anims.stop();
                this.player.setTexture("idleImage");
            }

            // Notify other clients once that this player has stopped moving.
            if (this.wasMoving && this.socket && this.playerObj && this.room) {
                this.socket.emit("player:move", {
                    id: this.playerObj.id,
                    x: this.player.x,
                    y: this.player.y,
                    roomId: this.room.id,
                    d: this.playerObj.state?.d,
                    moving: false,
                });
            }
            this.wasMoving = false;
            return;
        }

        // Ghost dùng logic riêng: bay lượn, không bị chặn bởi alive
        if (this.isGhost) {
            this.handleGhostMovement();
            return;
        }

        // Reset velocity each frame
        this.player.body.setVelocity(0, 0);

        const speed = this.scene.key === "WaitingLobby" ? 350 : 100;
        let vx = 0;
        let vy = 0;

        if (this.wKey.isDown) {
            vy = -speed;
        }
        if (this.sKey.isDown) {
            vy = speed;
        }
        if (this.aKey.isDown) {
            vx = -speed;
            this.playerObj.state.d = "left";
        }
        if (this.dKey.isDown) {
            vx = speed;
            this.playerObj.state.d = "right";
        }

        // Normalize diagonal movement
        if (vx !== 0 && vy !== 0) {
            vx *= 0.707;
            vy *= 0.707;
        }

        // Local Player Movement
        if (this.player.alive) {
            this.player.body.setVelocity(vx, vy);
            if (vx < 0) this.player.flipX = true;
            else if (vx > 0) this.player.flipX = false;
        }

        const isMoving = vx !== 0 || vy !== 0;
        if (isMoving) {
            if (!this.player.anims.isPlaying) {
                this.player.anims.play("walk");
            }
        } else {
            if (this.player.anims.isPlaying) {
                this.player.anims.stop();
                this.player.setTexture("idleImage");
            }
        }

        // Send movement to server
        if (isMoving || this.wasMoving) {
            this.time.delayedCall(0, () => {
                if (!this.player || !this.socket) return;
                this.socket.emit("player:move", {
                    id: this.playerObj.id,
                    x: this.player.x,
                    y: this.player.y,
                    roomId: this.room.id,
                    d: this.playerObj.state.d,
                    moving: isMoving,
                });
            });
        }
        this.wasMoving = isMoving;
    }

    /**
     * Load 48 frame ghost (ghost0001.png → ghost0048.png)
     */
    preloadGhostAssets() {
        for (let i = 1; i <= GHOST_FRAME_COUNT; i++) {
            const key = `ghost${String(i).padStart(4, "0")}`;
            this.load.image(key, `${GHOST_ASSET_DIR}/${key}.png`);
        }
    }

    /**
     * Animation bay lượn cho ghost
     */
    createGhostAnimation() {
        if (this.anims.exists("ghostFloat")) return;
        if (!this.textures.exists("ghost0001")) return;

        const frames = [];
        for (let i = 1; i <= GHOST_FRAME_COUNT; i++) {
            frames.push({ key: `ghost${String(i).padStart(4, "0")}` });
        }
        this.anims.create({
            key: "ghostFloat",
            frames,
            frameRate: 12,
            repeat: -1,
        });
    }

    /**
     * Load kill screen background + 48-frame imposter & victim kill animations
     */
    preloadKillAssets() {
        this.load.image("kill_screen", "assets/map/kill_screen.png");
        this.load.audio("alien_kill", "sound/alien_kill.mp3");

        for (let i = 1; i <= KILL_FRAME_COUNT; i++) {
            const pad = String(i).padStart(4, "0");
            this.load.image(
                `kill_imposter${pad}`,
                `${KILL_IMPOSTER_DIR}/killalien_imposter${pad}.png`,
            );
            this.load.image(
                `kill_victim${pad}`,
                `${KILL_VICTIM_DIR}/killalien_victim${pad}.png`,
            );
        }
    }

    /**
     * Create one-shot kill animations (48 frames ~ 3s)
     */
    createKillAnimations() {
        if (this.anims.exists("killImposter")) return;
        if (!this.textures.exists("kill_imposter0001")) return;

        const imposterFrames = [];
        const victimFrames = [];
        for (let i = 1; i <= KILL_FRAME_COUNT; i++) {
            const pad = String(i).padStart(4, "0");
            imposterFrames.push({ key: `kill_imposter${pad}` });
            victimFrames.push({ key: `kill_victim${pad}` });
        }

        // 48 frames in 3 seconds => ~16 fps
        const frameRate = KILL_FRAME_COUNT / (KILL_SCREEN_DURATION_MS / 1000);

        this.anims.create({
            key: "killImposter",
            frames: imposterFrames,
            frameRate,
            repeat: 0,
        });
        this.anims.create({
            key: "killVictim",
            frames: victimFrames,
            frameRate,
            repeat: 0,
        });
    }

    /**
     * Biến một sprite thành ghost: vẫn va chạm tường của bản đồ, đổi texture, bay lượn
     * @param {Phaser.Physics.Arcade.Sprite} sprite
     */
    makeGhost(sprite) {
        sprite.alive = false;
        sprite.isGhost = true;

        const sx = sprite.scaleX;
        const sy = sprite.scaleY;
        sprite.clearTint();
        sprite.setTexture("ghost0001");
        sprite.setScale(sx, sy);

        if (sprite.body) {
            // Bật lại va chạm (không còn tắt như phiên bản trước)
            sprite.body.checkCollision.none = false;
            // Không cho ghost ra khỏi biên của thế giới game
            sprite.setCollideWorldBounds(true);
        }

        // Ghost không đi xuyên tường: thêm collider với lớp va chạm của map
        if (this.collisionLayer && sprite.body) {
            this.physics.add.collider(sprite, this.collisionLayer);
        }

        if (this.anims.exists("ghostFloat")) {
            sprite.anims.play("ghostFloat", true);
        }
    }

    /**
     * Full-screen kill cinematic (only on the victim's client).
     * Shows kill_screen background + colored imposter & victim animations for 3s.
     * @param {string} [killerColor] Hex color of the imposter
     * @param {string} [victimColor] Hex color of the killed crewmate
     */
    showKillScreen(killerColor, victimColor) {
        if (!this.textures.exists("kill_screen")) {
            // Fallback if assets not loaded
            const box = this.add
                .rectangle(
                    this.scale.width / 2,
                    this.scale.height / 2,
                    120,
                    120,
                    0xff0000,
                )
                .setDepth(2001)
                .setScrollFactor(0);
            this.ui.add(box);
            this.time.delayedCall(KILL_SCREEN_DURATION_MS, () => box.destroy());
            return;
        }

        const w = this.scale.width;
        const h = this.scale.height;
        const cx = w / 2;
        const cy = h / 2;

        // Full-screen background (behind the characters)
        const bg = this.add
            .image(cx, cy, "kill_screen")
            .setDisplaySize(w, h)
            .setDepth(2000)
            .setScrollFactor(0);
        this.ui.add(bg);

        // Imposter (left) and victim (right) - side-by-side cinematic
        const imposter = this.add
            .sprite(cx - w * 0.08, cy, "kill_imposter0001")
            .setDepth(2001)
            .setScrollFactor(0)
            .setScale(0.85);
        const victim = this.add
            .sprite(cx + w * 0.08, cy, "kill_victim0001")
            .setDepth(2003)
            .setScrollFactor(0)
            .setScale(0.85);

        this.ui.add(imposter);
        this.ui.add(victim);

        // Apply player colors via the same ColorSwap pipeline (reset blend so it doesn't overlay the kill bg)
        if (killerColor) {
            try {
                setPlayerColor(this, imposter, killerColor);
                imposter.setBlendMode(Phaser.BlendModes.NORMAL);
            } catch (e) {
                console.warn("Failed to color kill imposter sprite", e);
            }
        }
        if (victimColor) {
            try {
                setPlayerColor(this, victim, victimColor);
                victim.setBlendMode(Phaser.BlendModes.NORMAL);
            } catch (e) {
                console.warn("Failed to color kill victim sprite", e);
            }
        }
        // Ensure animations exist then play
        this.createKillAnimations();
        if (this.anims.exists("killImposter")) {
            imposter.anims.play("killImposter");
        }
        if (this.anims.exists("killVictim")) {
            victim.anims.play("killVictim");
        }

        console.log("Audio exists?", this.cache.audio.exists("alien_kill"));
        console.log("Sound locked?", this.sound.locked);

        if (this.cache.audio.exists("alien_kill")) {
            this.sound.play("alien_kill", { volume: 0.8 });
        } else {
            console.warn("Không tìm thấy alien_kill trong cache!");
        }

        const victimBaseY = victim.y;
        victim.on("animationupdate", (anim, frame) => {
            const frameNum = frame.index + 1;
            if (frameNum >= 11 && frameNum <= 21) {
                victim.y = victimBaseY - 30;
            } else {
                victim.y = victimBaseY;
            }
        });
        // Cleanup after exactly 3 seconds
        this.time.delayedCall(KILL_SCREEN_DURATION_MS, () => {
            if (imposter && imposter.anims) imposter.anims.stop();
            if (victim && victim.anims) victim.anims.stop();
            bg.destroy();
            imposter.destroy();
            victim.destroy();
        });
    }

    /**
     * Chuyển người chơi local sang chế độ spectator
     */
    enterGhostMode() {
        if (this.isGhost || !this.player || !this.playerObj) return;

        this.isGhost = true;
        const id = this.playerObj.id;
        delete this.players[id];
        this.ghosts[id] = this.player;
        this.makeGhost(this.player);

        this.wasMoving = false;

        this.socket?.emit("player:spectate", {
            roomId: this.room.id,
            playerId: id,
        });
    }

    /**
     * Di chuyển của ghost (không va chạm tường)
     */
    handleGhostMovement() {
        const speed = this.scene.key === "WaitingLobby" ? 350 : 150;
        let vx = 0;
        let vy = 0;

        if (this.wKey.isDown) vy = -speed;
        if (this.sKey.isDown) vy = speed;
        if (this.aKey.isDown) vx = -speed;
        if (this.dKey.isDown) vx = speed;

        if (vx !== 0 && vy !== 0) {
            vx *= 0.707;
            vy *= 0.707;
        }

        this.player.body.setVelocity(vx, vy);
        if (vx < 0) {
            this.player.flipX = true;
            this.playerObj.state.d = "left";
        } else if (vx > 0) {
            this.player.flipX = false;
            this.playerObj.state.d = "right";
        }

        if (this.player.anims.currentAnim?.key !== "ghostFloat") {
            this.player.anims.play("ghostFloat", true);
        }

        const isMoving = vx !== 0 || vy !== 0;
        if (isMoving || this.wasMoving) {
            this.time.delayedCall(0, () => {
                if (!this.player || !this.socket) return;
                this.socket.emit("player:move", {
                    id: this.playerObj.id,
                    x: this.player.x,
                    y: this.player.y,
                    roomId: this.room.id,
                    d: this.playerObj.state.d,
                    moving: isMoving,
                });
            });
        }
        this.wasMoving = isMoving;
    }

    shutdown() {
        if (this._onChatFocus) EventBus.off("chat:focus", this._onChatFocus);
        this.cleanupSocketListeners();
    }
}
