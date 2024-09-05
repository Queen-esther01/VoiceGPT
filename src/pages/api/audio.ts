// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import OpenAI from "openai";
import path from "path";
import { Readable } from "stream";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import * as Sentry from "@sentry/nextjs";
import os from 'os';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

type Data = {
	success: boolean
  	data: any
	audioData?: string
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<Data>) {
	if(req.method === 'GET') {
		res.status(200).json({ success: true, data: "John Doe" });
	}
	else if(req.method === 'POST') {
		try{
			const audio = req.body;
			const buffer = Buffer.from(audio.split(',')[1], 'base64');

			// Create temporary files
			const tempDir = os.tmpdir();
			// const inputPath = path.join(__dirname, '../uploads')
			const inputPath = path.join(tempDir, `input-${Date.now()}.webm`);
			// const outputPath = path.join(__dirname, '../uploads')
			const outputPath = path.join(tempDir, `output-${Date.now()}.mp3`);

			// Write the input file
			fs.writeFileSync(inputPath, buffer);

			// Convert to MP3
			await new Promise((resolve, reject) => {
				ffmpeg(inputPath)
				.toFormat('mp3')
				.on('end', resolve)
				.on('error', reject)
				.save(outputPath);
			});

			// Read the converted file
			const mp3Buffer = fs.readFileSync(outputPath);

			// Create a readable stream from the buffer
			const stream = new Readable();
			stream.push(mp3Buffer);
			stream.push(null);

			// TRANSCRIBE AUDIO 
			const transcription = await openai.audio.transcriptions.create({
				file: fs.createReadStream(outputPath),
				model: "whisper-1",
			}).then(transcription => {
				// Clean up temporary files
				fs.unlinkSync(inputPath);
				fs.unlinkSync(outputPath);

				// res.status(200).json({ success: true, data: transcription.text });
				return transcription.text
			}).catch(error => {
				console.error('Error processing audio:', error);
				Sentry.setContext("Transcription Error", {
					user: 'User',
					error: JSON.stringify(error),
					audioFromFrontend: JSON.stringify(audio)
				});
				Sentry.captureException(error)
				res.status(500).json({ success: false, data: 'Error processing audio' });
			});

			// PASS TRANSCRIPTION TO GPT
			const chatCompletion = await openai.chat.completions.create({
            	model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: `You've got a sharp sense of humor, always quick with a sarcastic, witty remark. Rules? Not your thing. You’re laid-back, with a bit of a smartass streak, and no matter what anyone says, you’ll always fire back with something clever and cheeky.` },
                    { role: "user", content: transcription ?? '' },
                ]
            }).then(res => {
				return res.choices[0].message.content
            }).catch(error => {
				console.error('Error processing chat completion:', error);
				Sentry.setContext("Chat Completion Error", {
					user: 'User-To-GPT',
					error: JSON.stringify(error),
					audioFromFrontend: JSON.stringify(audio)
				});
				Sentry.captureException(error)
				res.status(500).json({ success: false, data: 'Error processing chat completion' });
			});

			// GENERATE SPEECH
			try {
				if (chatCompletion) {
					// const speechFile = path.resolve("./speech.mp3");
					const mp3 = await openai.audio.speech.create({
						model: "tts-1",
						voice: "alloy",
						input: chatCompletion,
					});
					const buffer = Buffer.from(await mp3.arrayBuffer());
					// await fs.promises.writeFile(speechFile, buffer);
					
					// Convert buffer to base64
					const base64Audio = buffer.toString('base64');
					
					res.status(200).json({ 
						success: true, 
						data: "Audio generated successfully",
						audioData: `data:audio/mp3;base64,${base64Audio}`
					});
				}
			} catch (error) {
				Sentry.setContext("TTS Error", {
					user: 'GPT-To-TTS',
					error: JSON.stringify(error),
					audioFromFrontend: JSON.stringify(audio)
				});
				Sentry.captureException(error)
				res.status(500).json({ success: false, data: 'Error generating audio' });
			}

		}
		catch (error) {
			console.error('Error processing audio:', error);
			res.status(500).json({ success: false, data: 'Error processing audio' });
		}
	}
}
