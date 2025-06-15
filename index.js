const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
	cors: {
		origin: "*",
	},
});

let rooms = {};
let socketToRoom = {};

function generateRoomCode() {
	const code = Math.random().toString(36).substring(2, 8).toUpperCase();
	return rooms[code] ? generateRoomCode() : code;
}

io.on("connection", (socket) => {
	console.log("🟢 玩家連線", socket.id);

	socket.on("create_room", ({ nickname, settings = {} }) => {
		const roomCode = generateRoomCode();
		rooms[roomCode] = {
			hostId: socket.id,
			players: [{ id: socket.id, nickname, score: 0, isHost: true }],
			settings: {
				maxPlayers: settings.maxPlayers || 5,
				questions: settings.questions || 10,
				timer: settings.timer || 15,
			},
			gameInProgress: false,
		};

		socket.join(roomCode);
		socketToRoom[socket.id] = roomCode;

		console.log(
			`====== 創建房間 ======\n生成房間代碼: ${roomCode}\n創建者昵稱: ${nickname}\n創建者 Socket ID: ${socket.id}\n房間創建完成: ${roomCode}, 房主: ${nickname}`
		);

		io.to(roomCode).emit("room_update", {
			roomCode,
			hostId: socket.id,
			players: rooms[roomCode].players,
			settings: rooms[roomCode].settings,
		});
	});

	socket.on("join_room", ({ nickname, roomCode }) => {
		const room = rooms[roomCode];
		if (!room || room.gameInProgress) return;
		const alreadyUsed = room.players.some(
			(p) => p.nickname.toLowerCase() === nickname.toLowerCase()
		);
		if (alreadyUsed) return;

		room.players.push({ id: socket.id, nickname, score: 0, isHost: false });
		socket.join(roomCode);
		socketToRoom[socket.id] = roomCode;

		io.to(roomCode).emit("room_update", {
			roomCode,
			hostId: room.hostId,
			players: room.players,
			settings: room.settings,
		});
	});

	socket.on("start_next_question", () => {
		const roomCode = socketToRoom[socket.id];
		const room = rooms[roomCode];
		if (!room || !room.gameInProgress) return;

		console.log(`[DEBUG] 收到來自 ${socket.id} 的開始下一題請求`);
		startNextQuestion(roomCode);
	});

	socket.on("start_game", ({ roomCode }) => {
		const room = rooms[roomCode];
		if (!room || room.hostId !== socket.id || room.players.length < 2) return;
		room.gameInProgress = true;
		room.currentQuestion = 0;
		room.totalQuestions = room.settings.questions;
		io.to(roomCode).emit("game_started", room.settings);
		startNextQuestion(roomCode);
	});

	// 關鍵部分：答案提交處理
	// 先定義一個暗號，確保下面的代碼是真正新的解決方案 - RED_ALERT_FIX_V2

	// 在 socket.on("submit_answer") 事件中徹底修改答對處理邏輯:
	socket.on("submit_answer", async ({ answer }) => {
		const roomCode = socketToRoom[socket.id];
		const room = rooms[roomCode];
		if (!room || !room.gameInProgress) return;

		const player = room.players.find((p) => p.id === socket.id);
		if (!player) return;

		// 如果已經有人答對了，直接忽略
		if (room.questionAnswered) {
			return;
		}

		const userAnswer = answer.toLowerCase().trim();
		const acceptedAnswers = room.currentQuestionData?.acceptedAnswers || [];

		let isCorrect = false;
		for (const acceptedAnswer of acceptedAnswers) {
			if (
				userAnswer === acceptedAnswer ||
				userAnswer.includes(acceptedAnswer) ||
				acceptedAnswer.includes(userAnswer)
			) {
				isCorrect = true;
				break;
			}
		}

		// 通知所有玩家這個人的答案
		io.to(roomCode).emit("player_answered", {
			playerId: socket.id,
			nickname: player.nickname,
			answer,
			correct: isCorrect,
		});

		// 如果答對了
		if (isCorrect) {
			// 立刻標記已答對
			room.questionAnswered = true;

			// 加分
			player.score += 1;

			// 更新分數
			io.to(roomCode).emit("game_update", {
				players: room.players,
			});

			// 停止所有計時器
			clearAllTimers(room);

			io.to(roomCode).emit("show_answer", {
				correctAnswer: room.currentQuestionData.correctAnswer,
				answeredBy: player.nickname, // 這樣可以在前端顯示是誰答對
			});

			// 延遲切題
			room.nextQuestionTimer = setTimeout(() => {
				startNextQuestion(roomCode);
			}, 1500);
		}
	});

	socket.on("disconnect", () => {
		const roomCode = socketToRoom[socket.id];
		if (!roomCode || !rooms[roomCode]) return;

		const room = rooms[roomCode];
		const playerIndex = room.players.findIndex((p) => p.id === socket.id);
		if (playerIndex === -1) return;

		const wasHost = room.players[playerIndex].isHost;
		const nickname = room.players[playerIndex].nickname;
		room.players.splice(playerIndex, 1);

		console.log(`🔴 玩家 ${nickname} 從房間 ${roomCode} 離開`);

		if (room.players.length === 0 || wasHost) {
			endGame(roomCode, wasHost ? "host_left" : "all_players_left", {
				hostDisconnected: wasHost,
				message: wasHost ? "房主已離開遊戲" : "所有玩家已離開",
			});
			delete rooms[roomCode];
			console.log(`🗑️ 移除房間 ${roomCode}`);
		} else {
			if (wasHost) {
				room.players[0].isHost = true;
				room.hostId = room.players[0].id;
			}
			io.to(roomCode).emit("room_update", {
				roomCode,
				hostId: room.hostId,
				players: room.players,
				settings: room.settings,
			});
		}

		delete socketToRoom[socket.id];
	});
});

function clearAllTimers(room) {
	// 清除所有計時器
	if (room.timer) {
		console.log("⏱️ 清除倒計時計時器");
		clearInterval(room.timer);
		room.timer = null;
	}
	if (room.nextQuestionTimer) {
		console.log("⏱️ 清除下一題計時器");
		clearTimeout(room.nextQuestionTimer);
		room.nextQuestionTimer = null;
	}
}

async function fetchRandomPokemon() {
	try {
		const id = Math.floor(Math.random() * 1010) + 1;
		console.log(`🔍 獲取寶可夢 ID: ${id}`);

		const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
		const data = await res.json();

		const speciesRes = await fetch(data.species.url);
		const speciesData = await speciesRes.json();

		const zhEntry = speciesData.names.find(
			(n) => n.language.name === "zh-Hant"
		);
		const nameZh = zhEntry?.name || speciesData.names[0]?.name || "未知";
		const allNames = speciesData.names.map((n) => n.name);
		allNames.push(data.name);

		console.log(`✅ 已獲取寶可夢: ${nameZh}`);

		return {
			imageUrl: data.sprites.other["official-artwork"].front_default,
			correctAnswer: nameZh,
			acceptedAnswers: allNames.map((n) => n.toLowerCase()),
		};
	} catch (error) {
		console.error(`❌ 獲取寶可夢失敗:`, error);
		throw error;
	}
}

async function startNextQuestion(roomCode) {
	console.log(`🔄 立即切換到下一題 (房間: ${roomCode})`);

	const room = rooms[roomCode];
	if (!room) return;

	// 清除所有計時器
	clearAllTimers(room);

	// 重置狀態
	room.questionAnswered = false;

	// 增加題號
	room.currentQuestion++;

	// 檢查是否遊戲結束
	if (room.currentQuestion > room.totalQuestions) {
		endGame(roomCode, "game_completed");
		return;
	}

	try {
		// 立即獲取新題目
		const questionData = await fetchRandomPokemon();

		// 設置題目數據
		room.currentQuestionData = questionData;
		room.timeRemaining = room.settings.timer;

		// 立即發送給所有玩家
		io.to(roomCode).emit("game_question", {
			imageUrl: questionData.imageUrl,
			questionNumber: room.currentQuestion,
			totalQuestions: room.totalQuestions,
			timeRemaining: room.timeRemaining,
			acceptedAnswers: questionData.acceptedAnswers,
			correctAnswer: questionData.correctAnswer,
		});

		// 設置計時器
		room.timer = setInterval(() => {
			room.timeRemaining--;

			io.to(roomCode).emit("time_update", {
				timeRemaining: room.timeRemaining,
			});

			if (room.timeRemaining <= 0) {
				clearInterval(room.timer);
				room.timer = null;

				io.to(roomCode).emit("show_answer", {
					correctAnswer: questionData.correctAnswer,
				});

				// 時間到也是直接切換
				startNextQuestion(roomCode);
			}
		}, 1000);
	} catch (error) {
		console.error(`獲取題目失敗:`, error);
		// 失敗時重試
		startNextQuestion(roomCode);
	}
}

function endGame(roomCode, reason = "game_completed", opts = {}) {
	const room = rooms[roomCode];
	if (!room) return;

	console.log(`🏁 遊戲結束 (房間: ${roomCode}, 原因: ${reason})`);

	// 清除所有計時器
	clearAllTimers(room);

	room.gameInProgress = false;

	// 排序玩家並添加排名
	const rankedPlayers = [...room.players]
		.sort((a, b) => b.score - a.score)
		.map((player, index, arr) => {
			if (index > 0 && player.score === arr[index - 1].score) {
				player.rank = arr[index - 1].rank;
			} else {
				player.rank = index + 1;
			}
			return player;
		});

	// 發送遊戲結束事件
	console.log(
		`📣 發送遊戲結束事件，獲勝者: ${rankedPlayers[0]?.nickname || "無"}`
	);
	io.to(roomCode).emit("game_over", {
		players: rankedPlayers,
		winner: rankedPlayers.length > 0 ? rankedPlayers[0] : null,
		reason: reason,
		message: opts.message || "遊戲結束",
		hostDisconnected: !!opts.hostDisconnected,
		roomCode: roomCode,
		totalQuestions: room.totalQuestions || 0,
	});
}

server.listen(3001, () => {
	console.log("Server listening on port 3001");
});
