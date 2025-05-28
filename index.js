const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
	cors: {
		origin: "*", // 允許所有來源（開發階段用）
		methods: ["GET", "POST"]
	}
});

app.use(cors());

const PORT = process.env.PORT || 3001;

// 記錄所有房間與玩家
let rooms = {};

io.on("connection", (socket) => {
	console.log("🟢 使用者連線:", socket.id);

	// 玩家加入房間
	socket.on("joinRoom", ({ roomId, playerName }) => {
		if (!rooms[roomId]) {
			rooms[roomId] = {
				players: []
			};
		}

		rooms[roomId].players.push({
			id: socket.id,
			name: playerName,
			score: 0
		});

		socket.join(roomId);
		console.log(`👥 ${playerName} 加入房間 ${roomId}`);

		// 廣播房間資訊給其他玩家
		io.to(roomId).emit("roomUpdate", rooms[roomId].players);
	});

	// 玩家回答題目
	socket.on("submitAnswer", ({ roomId, playerName, answer, correct }) => {
		const player = rooms[roomId]?.players.find((p) => p.name === playerName);
		if (player && correct) {
			player.score += 1;
		}
		io.to(roomId).emit("roomUpdate", rooms[roomId].players);
	});

	// 玩家離開
	socket.on("disconnect", () => {
		for (const roomId in rooms) {
			rooms[roomId].players = rooms[roomId].players.filter(
				(p) => p.id !== socket.id
			);
			io.to(roomId).emit("roomUpdate", rooms[roomId].players);
		}
		console.log("🔴 使用者離線:", socket.id);
	});
});

server.listen(PORT, () => {
	console.log(`🚀 Socket.IO 伺服器已啟動於 http://localhost:${PORT}`);
});
