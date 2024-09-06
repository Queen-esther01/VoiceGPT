import "@/styles/globals.css";
import type { AppProps } from "next/app";
import Head from "next/head";

const globalStyles = `
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .animate-fade-in {
    animation: fadeIn 0.3s ease-out;
  }
`;

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <style>{globalStyles}</style>
				<title>Speak With GPT</title>
				<meta name="description" content="Speak with GPT allows you to speak with GPT and get a response in audio format." />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<link rel="icon" href="/favicon.ico" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
