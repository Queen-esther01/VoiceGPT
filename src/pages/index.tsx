"use client"

import { Inter } from "next/font/google";
import { useEffect, useRef, useState } from "react";
import { HiMicrophone } from "react-icons/hi2";
import { FaStopCircle } from "react-icons/fa";
import { motion, AnimatePresence } from 'framer-motion';
import { RiRobot2Line } from "react-icons/ri";
import { LuUser2 } from "react-icons/lu";
import * as Sentry from "@sentry/nextjs";

const inter = Inter({ subsets: ["latin"] });

interface AudioMessage {
	audioData: string; // base64 encoded audio data
	isUser: boolean;
	timestamp: number;
}

export default function Home() {
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const audioChunksRef = useRef<Blob[]>([]);
	const containerRef = useRef<HTMLDivElement>(null);
	const beepAudioRef = useRef<HTMLAudioElement | null>(null);

	const [isRecording, setIsRecording] = useState(false);
	const [audioURL, setAudioURL] = useState<string | null>(null);
	const [audioStore, setAudioStore] = useState<AudioMessage[]>([]);
	const [generatingGptSpeech, setGeneratingGptSpeech] = useState(false);

	useEffect(() => {
		if (containerRef.current) {
			containerRef.current.scrollTop = containerRef.current.scrollHeight;
		}
	}, [audioStore]);

	useEffect(() => {
		beepAudioRef.current = new Audio('/beep.mp3'); // Adjust the path as needed
	}, []);

	const playBeep = () => {
		if (beepAudioRef.current) {
			beepAudioRef.current.play().catch(error => console.error('Error playing beep:', error));
		}
	};

	const startRecording = async () => {
		if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
			// setError("Your browser doesn't support audio recording");
			return;
		}

		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const options = { mimeType: 'audio/webm;codecs=opus' };
			const mediaRecorder = new MediaRecorder(stream, options);
			mediaRecorderRef.current = mediaRecorder;
			audioChunksRef.current = [];

			mediaRecorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					audioChunksRef.current.push(event.data);
				}
			};

			mediaRecorder.onstop = () => {
				const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
				const audioUrl = URL.createObjectURL(audioBlob);
				setAudioURL(audioUrl);
			};

			mediaRecorder.start();
			setIsRecording(true);
			playBeep()
		} catch (error) {
			Sentry.captureException(error)
			console.error('Error accessing microphone. Please check your permissions.', error);
		}
	};
	// console.log(audioURL);

	const stopRecording = () => {
		if (mediaRecorderRef.current) {
			mediaRecorderRef.current.stop();
			setIsRecording(false)

			mediaRecorderRef.current.onstop = async () => {
				const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
				const audioUrl = URL.createObjectURL(audioBlob);
				setAudioURL(audioUrl);
				// Immediately save the audio
				Sentry.captureMessage('RecorderStopped', {
					level: "info",
					extra: {
						audioBlob: JSON.stringify(audioBlob),
						audioUrl: JSON.stringify(audioUrl)
					},
				});
				await saveAudio(true, audioBlob);
			};
		}
	};

	useEffect(() => {
		const storedAudio = JSON.parse(localStorage.getItem('audioStore') || '[]');
		setAudioStore(storedAudio);
		setCanAutoplay(true)
	}, []);

	const [showToast, setShowToast] = useState(false);

	console.log(audioURL)
	const saveAudio = async(isUser: boolean, audioBlob: Blob) => {
		if(audioStore.length > 17){
			setShowToast(true)
			setIsRecording(false)
			setAudioURL(null)
			setTimeout(() => {
				setShowToast(false)
			}, 3000);
			return
		}
		try {
			const reader = new FileReader();
			reader.onloadend = async() => {
				const base64AudioMessage = reader.result as string;
				const newAudioMessage: AudioMessage = {
					audioData: base64AudioMessage,
					isUser: isUser,
					timestamp: Date.now()
				};
				Sentry.captureMessage('AudioMessage', {
					level: "info",
					extra: {
						audioMessage: JSON.stringify(newAudioMessage),
					},
				});
				const updatedAudioStore = [...audioStore, newAudioMessage];
				setAudioStore(updatedAudioStore);
				localStorage.setItem('audioStore', JSON.stringify(updatedAudioStore));
				setAudioURL(null);
				setGeneratingGptSpeech(true)

				// SEND TO SERVER
				await fetch('/api/audio', {
					method: 'POST',
					body: base64AudioMessage,
				})
				.then(res => res.json())
				.then(data => {
					setGeneratingGptSpeech(false)
					if(data.success && data.data === "Audio generated successfully"){
						const responseAudio = {
							audioData: data.audioData,
							isUser: false,
							timestamp: Date.now()
						}
						const currentStore = JSON.parse(localStorage.getItem('audioStore') || '[]');
						const newStore = [...currentStore, responseAudio];
						localStorage.setItem('audioStore', JSON.stringify(newStore));
						setAudioStore(newStore);
					}
					else{
						setGeneratingGptSpeech(false)
						Sentry.setContext("TTS Error", {
							user: isUser ? 'User' : 'GPT',
							error: JSON.stringify(data),
							audioMessage: JSON.stringify(newAudioMessage)
						});
						Sentry.captureException(data)
					}
				})
				.catch(error => {
					setGeneratingGptSpeech(false)
					Sentry.setContext("TTS Error", {
						user: isUser ? 'User' : 'GPT',
						error: JSON.stringify(error)
					});
					Sentry.captureException(error)
					console.error('Error saving audio:', error);
					console.log(error)
				});
			};
			reader.onerror = (error) => {
				setGeneratingGptSpeech(false)
				Sentry.setContext(`Saving ${isUser ? 'User' : 'GPT'} Audio Error`, {
					user: isUser ? 'User' : 'GPT',
					error: JSON.stringify(error)
				});
				Sentry.captureException(error)
				console.error('Error saving audio:', error);
			}
			reader.readAsDataURL(audioBlob)
		} 
		catch (error) {
			setGeneratingGptSpeech(false)
			Sentry.captureException(error)
			console.error('Error saving audio:', error);
		}
	};


	const [canAutoplay, setCanAutoplay] = useState(false);
	const latestAudioRef = useRef<HTMLAudioElement>(null);


	useEffect(() => {
		const lastAudio = audioStore[audioStore.length - 1];
		if (lastAudio && !lastAudio.isUser && latestAudioRef.current && canAutoplay) {
			latestAudioRef.current.play().catch(error => console.error("Autoplay failed:", error))
		}
	}, [audioStore, canAutoplay]);

	const clearConversation = () => {
		setAudioStore([]);
		localStorage.removeItem('audioStore');
	}



	return (
		<>
			<main className={`h-screen flex flex-col items-center justify-between ${inter.className}`} >
				{
					showToast &&
					<div onClick={() => setShowToast(false)} className="fixed top-0 left-0 w-full h-full bg-black bg-opacity-50 flex items-center justify-center z-50">
						<div className="bg-white p-4 mx-10 rounded-lg">
							<p className="text-red-500">You have reached the maximum number of messages, clear conversation.</p>
						</div>
					</div>
				}
				<header className="sticky top-0 bg-white w-full text-center py-5 z-50">
					<div className="flex flex-col md:flex-row gap-4 justify-between items-center max-w-xl mx-auto">
						<h1 className="text-2xl font-bold text-[#0f172a]">VoiceGPT</h1>
						<div className="flex items-center">
							<input
								type="checkbox"
								id="autoplayCheckbox"
								checked={canAutoplay}
								onChange={(e) => setCanAutoplay(e.target.checked)}
								className="mr-2"
							/>
							<label htmlFor="autoplayCheckbox">Enable autoplay</label>
						</div>
						<button className="bg-blue-500 hover:bg-blue-600 text-white p-2 px-4 rounded-3xl transition-all duration-300 ease-in-out transform hover:scale-105"
							onClick={clearConversation}>Clear Conversation
						</button>
					</div>
				</header>
				<div className="h-screen  w-full md:w-1/2 max-w-lg p-5">
					<div ref={containerRef}  className='h-[50vh] 2xl:h-[60vh] overflow-y-auto'>
						{
							audioStore.length === 0 &&
							<div className="flex justify-center items-center h-full">
								<p className="text-gray-500">No conversations yet</p>
							</div>
						}
						<AnimatePresence>
							{
								audioStore && audioStore?.map((audio: AudioMessage, index: number) => (
									<motion.div 
										key={audio.timestamp} 
										className={`flex gap-2 items-center ${audio.isUser ? 'justify-end' : 'justify-start'} mb-4`}
										initial={{ opacity: 0, y: 20 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0, y: -20 }}
										transition={{ duration: 0.3 }}
									>
										{
											!audio.isUser &&
											<RiRobot2Line className="text-[#64748b]" size={20} />
										}
										{
											!audio.isUser && index === audioStore.length - 1 && generatingGptSpeech &&
											<div>
												<p className="text-sm text-gray-500">Generating GPT response...</p>
											</div>
										}
										<audio className="py-2 max-w-[70%]" src={audio.audioData} controls ref={index === audioStore.length - 1 ? latestAudioRef : null} />
										
										{
											audio.isUser &&
											<LuUser2 className="text-[#64748b]" size={20} />
										}
									</motion.div>
								))
							}
							{
								generatingGptSpeech && 
								<div className="flex gap-2 items-center justify-start mb-4">
									<RiRobot2Line className="text-[#64748b]" size={20} />
									<div>
										<p className="text-sm text-gray-500">Generating GPT response...</p>
									</div>
								</div>
							}
						</AnimatePresence>
					</div>
					<div className="bg-white shadow-lg fixed bottom-0 left-0 right-0 flex justify-center mx-auto py-7 border w-full transition-all duration-300 ease-in-out">
						{
							!isRecording && !audioURL && (
								<div className="flex flex-col items-center">
									<button 
										onClick={startRecording}
										className="bg-gray-300 hover:bg-blue-600 text-white rounded-full p-3 transition-all duration-300 ease-in-out transform hover:scale-110"
									>
										<HiMicrophone className="text-4xl" />
									</button>
									<p className="text-sm mt-2">Start Recording</p>
								</div>
							)
						}
						{
							isRecording && (
								<div className="flex flex-col items-center">
									<button 
										onClick={stopRecording}
										className="bg-red-500 hover:bg-red-600 text-white rounded-full p-3 transition-all duration-300 ease-in-out transform hover:scale-110"
								>
									<FaStopCircle className="text-4xl" />
								</button>
								<p className="text-sm mt-2">Stop Recording</p>
							</div>
						)
						}
						{/* {
							audioURL && 
							<div className="flex items-center animate-fade-in w-11/12 justify-center space-x-2">
								<audio src={audioURL} controls  />
								<button className="bg-green-500 hover:bg-green-600 text-white p-2 px-4 rounded-3xl self-center transition-all duration-300 ease-in-out transform hover:scale-105" 
									onClick={() => saveAudio(true)}>Save
								</button>
								<GrRefresh onClick={redoRecording} className="cursor-pointer text-gray-500" />
							</div>
						} */}
					</div>
				</div>
			</main>
		</>
	);
}
