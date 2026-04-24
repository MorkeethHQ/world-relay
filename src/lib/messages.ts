export type Message = {
  id: string;
  taskId: string;
  sender: "relay-bot" | string;
  text: string;
  timestamp: string;
};

const messageStore = new Map<string, Message[]>();

export function addMessage(taskId: string, sender: string, text: string): Message {
  const messages = messageStore.get(taskId) || [];
  const msg: Message = {
    id: crypto.randomUUID(),
    taskId,
    sender,
    text,
    timestamp: new Date().toISOString(),
  };
  messages.push(msg);
  messageStore.set(taskId, messages);
  return msg;
}

export function getMessages(taskId: string): Message[] {
  return messageStore.get(taskId) || [];
}
