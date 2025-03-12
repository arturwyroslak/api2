// server.js (Node.js server)
import express from 'express';
import fetch, { Headers } from 'node-fetch'; // Use node-fetch
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import bodyParser from 'body-parser';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const app = express();
const port = process.env.PORT || 10000;

// Serve static files (HTML, CSS, JS) from the 'public' directory
app.use(express.static(__dirname));
app.use(bodyParser.json());


// --- API Endpoints (using Express.js) ---

app.post('/api/chat', async (req, res) => {
  try {
    const result = await processChatCompletions(req.body);
     if (result.isStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.write(result.rawStream); // Send the raw stream data
        res.end();
    } else {
        res.json(result);
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/models', async (req, res) => {
    try {
      const result = await handleApiRequest(req.path, req.method);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
});
  
app.get('/api/status', async (req, res) => {
    try {
      const result = await handleApiRequest(req.path, req.method);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/api/health', async (req, res) => {
     try {
      const result = await handleApiRequest(req.path, req.method);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
});


// ---  API Logic (same as in the HTML, but now in a Node.js context) ---

async function handleApiRequest(path, method, body) {
    if (path === '/api/chat' && method === 'POST') {
        return await processChatCompletions(body);
    } else if (path === '/api/models' && method === 'GET') {
        return { models: ['gpt-4o-mini', 'claude-3-haiku', 'llama', 'mixtral', 'o3-mini'] };
    } else if (path === '/api/status' && method === 'GET') {
        const vqd = await requestNewVQD();
        return { status: 'OK', vqd };
    } else if (path === '/api/health' && method === 'GET') {
        return { status: 'OK' };
    } else {
        return { error: 'Not Found', status: 404 };
    }
}

async function processChatCompletions(requestBody) {
     let isStream = false

    const models = ['gpt-4o-mini', 'claude-3-haiku-20240307', 'meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mixtral-8x7B-Instruct-v0.1']; //懒得支持多模型了，默认gpt4omini
    if (!requestBody) return {error: 'Request body is empty', status: 400};
    let message
    let messageData;
    try {
        message = requestBody;
        messageData = message.messages;
    } catch (error) {
        return {error: 'Invalid JSON format', status: 400};
    }
    const messages = {
        model: "gpt-4o-mini",
        messages: [{
            role: "user",
            content: JSON.stringify(messageData)
        }]
    };
    isStream = message.stream
    console.log("request:", messages);
    let vqd = await requestNewVQD();

    console.log('request VQD:', vqd);
    const apiHeader = new Headers();
    apiHeader.append("accept", "text/event-stream");
    apiHeader.append("accept-language", "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6,zh-HK;q=0.5");
    apiHeader.append("content-type", "application/json");
    apiHeader.append("referer", "https://test.com");
    apiHeader.append("x-vqd-4", vqd);
    const requestOptions = {
        method: "POST",
        headers: apiHeader,
        body: JSON.stringify(messages),
        redirect: "follow"
    };
    return fetchData(requestOptions, messageData, isStream);
}

async function fetchData(requestOptions, messageData, isStream) {
    const targetUrl = "https://duckduckgo.com/duckchat/v1/chat";
    const response = await fetch(targetUrl, requestOptions);
    // Check if the response status is OK (200)
    if (!response.ok) {
        // If not, read the response body to get the error message
        const errorBody = await response.text();
        console.error('Fetch error:', response.status, errorBody);

        if (response.status == 429) {
            if (errorBody.includes("429 Too Many Requests")) {
                return {error: errorBody, status: response.status};
            }
                        const errorJson = JSON.parse(errorBody)
            if (errorJson.type === 'ERR_INPUT_LIMIT') {
                console.error('输入超限')
                let newrequestOptions = requestOptions
                let newMessageData = messageData
                if (newMessageData.length > 1) {
                    newMessageData.splice(1, 1); // 移除第二项
                } else {
                   return {error: errorBody, status: response.status};
                }
                const messages = {
                    model: "gpt-4o-mini",
                    messages: [{
                        role: "user",
                        content: JSON.stringify(newMessageData)
                    }]
                };
                newrequestOptions.body = JSON.stringify(messages)
                await delay(300);
                return fetchData(newrequestOptions, newMessageData, isStream)

            }

        }
        // Return a response with the error details
        return {error: errorBody, status: response.status};
    }

    const responseVQD = response.headers.get("x-vqd-4");
    console.log('response VQD:', responseVQD);

    if (responseVQD == null) {
        console.error('response VQD header is null, retrying...');
        await delay(300);
        return fetchData(requestOptions, messageData, isStream); // Recursive call to retry the request
    }

    if (isStream) {
        // Streaming response (simplified for Node.js - no ReadableStream)
        let accumulatedData = '';
        let newMessage = '';
        let result = '';

        const text = await response.text();
        const lines = text.split('\n');

        for (const line of lines) {
             if (line.startsWith('data:')) {
                const clearMessage = line.substring(5).trim();
                try {
                    const jsonMessage = JSON.parse(clearMessage);
                    if (jsonMessage.message) {
                        newMessage += jsonMessage.message;
                    }
                } catch (error) {}
                const processedMessage = processChunk(clearMessage);
                result += 'data: ' + processedMessage + '\n\n';
            }
        }
        console.log("answer: ", newMessage);
        return { response: newMessage, rawStream: result, isStream: true };

    } else {
        // Non-streaming response
       let inputData = await response.text()
        const messages = [];
        const regex = /data: ({.*?})/g;
        let match;

        // 用于存储最后的 id、created 和 model
        let finalId = '';
        let finalCreated = 0;
        let finalModel = '';

        while ((match = regex.exec(inputData)) !== null) {
            const jsonData = JSON.parse(match[1]);
            if (jsonData.message) {
                messages.push(jsonData.message);
            }
            
            if (jsonData.id) {
                finalId = jsonData.id;
            }
            if (jsonData.created) {
                finalCreated = jsonData.created;
            }
            if (jsonData.model) {
                finalModel = jsonData.model; 
            }
        }

        const outputJson = {
            id: finalId,
            object: "chat.completion",
            created: finalCreated,
            model: finalModel,
            choices: [{
                message: {
                    role: "assistant",
                    content: messages.join('')
                },
                finish_reason: "stop",
                index: 0
            }]
        };

        return outputJson;
    }
}

function processChunk(chunk) {
    let originalMessage;
    try {
        originalMessage = JSON.parse(chunk);
    } catch (e) {
        return `${chunk}`;
    }
    const openAiResponse = {
        id: originalMessage.id,
        object: "chat.completion",
        created: originalMessage.created,
        model: originalMessage.model,
        choices: [{
            index: 0,
            delta: {
                content: originalMessage.message
            },
            finish_reason: null,
            content_filter_results: null
        }]
    };
    return `${JSON.stringify(openAiResponse)}`;
}

async function requestNewVQD() {
    const myHeaders = new Headers();
    myHeaders.append("x-vqd-accept", "1");
    const requestOptions = {
        method: "GET",
        headers: myHeaders,
        redirect: "follow"
    };
    try {
        const response = await fetch("https://duckduckgo.com/duckchat/v1/status", requestOptions);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const vqd = response.headers.get("x-vqd-4");
        return vqd;
    } catch (error) {
        console.error(error);
        return null;
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Start the server
app.listen(port, () => {
  console.log(`Server listening at http://0.0.0.0:${port}`);
});
